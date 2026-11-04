const { createClient } = require('@supabase/supabase-js');

const PAGE_ID = '1106362315902155';
const GRAPH_VERSION = 'v24.0';
const SITE_ORIGIN = 'https://www.sprachenschule.co.ke';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, private');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  try {
    const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, META_PAGE_ACCESS_TOKEN } = process.env;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY || !META_PAGE_ACCESS_TOKEN) {
      return res.status(503).json({ error: 'Facebook publishing is not fully configured. Check the server environment variables.' });
    }

    const authHeader = req.headers.authorization || '';
    const sessionToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!sessionToken) return res.status(401).json({ error: 'Please sign in again.' });

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data: authData, error: authError } = await authClient.auth.getUser(sessionToken);
    if (authError || !authData.user) return res.status(401).json({ error: 'Your registrar session is invalid or expired.' });

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const userId = authData.user.id;
    const [registrar, profile] = await Promise.all([
      admin.from('registrars').select('user_id').eq('user_id', userId).maybeSingle(),
      admin.from('profiles').select('role').eq('id', userId).maybeSingle()
    ]);
    if (registrar.error || profile.error) return res.status(503).json({ error: 'Could not verify registrar permissions.' });
    if (!registrar.data && !['registrar', 'admin'].includes(String(profile.data?.role || '').toLowerCase())) {
      return res.status(403).json({ error: 'Only a registrar or administrator can publish to Facebook.' });
    }

    const postId = req.body?.post_id;
    if (typeof postId !== 'string' || !/^[0-9a-f-]{36}$/i.test(postId)) {
      return res.status(400).json({ error: 'A valid blog article ID is required.' });
    }

    const { data: post, error: postError } = await admin.from('blog_posts')
      .select('id,slug,title,excerpt,image_url,published,facebook_post_id,facebook_post_status')
      .eq('id', postId).maybeSingle();
    if (postError) return res.status(503).json({ error: 'Could not load the blog article.' });
    if (!post) return res.status(404).json({ error: 'Blog article not found.' });
    if (!post.published) return res.status(409).json({ error: 'Only published articles can be posted to Facebook.' });
    if (post.facebook_post_id || post.facebook_post_status === 'posted') {
      return res.status(200).json({ success: true, status: 'already_posted', facebook_post_id: post.facebook_post_id || null });
    }
    if (post.facebook_post_status === 'publishing') {
      return res.status(202).json({ success: true, status: 'publishing' });
    }

    const claim = await admin.from('blog_posts')
      .update({ facebook_post_status: 'publishing', facebook_post_error: null })
      .eq('id', postId).is('facebook_post_id', null)
      .or('facebook_post_status.is.null,facebook_post_status.eq.failed')
      .select('id').maybeSingle();
    if (claim.error) return res.status(503).json({ error: 'Could not reserve this article for Facebook publishing.' });
    if (!claim.data) return res.status(200).json({ success: true, status: 'already_posted_or_in_progress' });

    const articleUrl = SITE_ORIGIN + '/blog.html?slug=' + encodeURIComponent(post.slug);
    const message = [post.title, post.excerpt, articleUrl].filter(Boolean).join('\n\n');
    const endpoint = post.image_url ? 'photos' : 'feed';
    const graphUrl = new URL('https://graph.facebook.com/' + GRAPH_VERSION + '/' + PAGE_ID + '/' + endpoint);
    const params = new URLSearchParams({ access_token: META_PAGE_ACCESS_TOKEN });
    if (post.image_url) {
      params.set('url', post.image_url);
      params.set('caption', message);
    } else {
      params.set('message', message);
      params.set('link', articleUrl);
    }

    let graphResponse;
    let graphData;
    try {
      graphResponse = await fetch(graphUrl.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });
      graphData = await graphResponse.json();
    } catch (networkError) {
      await admin.from('blog_posts').update({
        facebook_post_status: 'failed',
        facebook_post_error: 'Could not confirm Meta response. Check the Page before retrying to avoid a duplicate.'
      }).eq('id', postId);
      return res.status(502).json({ error: 'Meta did not return a clear response. Check the Facebook Page before trying again.' });
    }

    if (!graphResponse.ok || !graphData.id) {
      const safeError = graphData.error?.message || 'Meta rejected the Facebook post.';
      await admin.from('blog_posts').update({
        facebook_post_status: 'failed',
        facebook_post_error: safeError.slice(0, 1000)
      }).eq('id', postId);
      return res.status(502).json({ error: safeError });
    }

    const saved = await admin.from('blog_posts').update({
      facebook_post_id: graphData.id,
      facebook_post_status: 'posted',
      facebook_posted_at: new Date().toISOString(),
      facebook_post_error: null
    }).eq('id', postId);
    if (saved.error) {
      console.error('Facebook post succeeded but its ID could not be saved for article', postId);
      return res.status(503).json({ error: 'Facebook accepted the post, but the post ID could not be saved. Do not retry; contact the administrator.' });
    }

    return res.status(200).json({ success: true, status: 'posted', facebook_post_id: graphData.id });
  } catch (error) {
    console.error('Facebook blog publishing failed:', error?.message || 'Unknown error');
    return res.status(500).json({ error: 'Facebook publishing failed unexpectedly.' });
  }
};
