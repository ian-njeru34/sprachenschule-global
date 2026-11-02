const { createClient } = require('@supabase/supabase-js');
module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow','POST'); return res.status(405).json({error:'Method not allowed.'}); }
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(503).json({error:'Server is not configured.'});
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
  if(!token) return res.status(401).json({error:'Sign in as registrar first.'});
  const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth?.user) return res.status(401).json({error:'Your session is invalid or expired.'});
  const [{data:registrar},{data:actor}]=await Promise.all([
    db.from('registrars').select('user_id').eq('user_id',auth.user.id).maybeSingle(),
    db.from('profiles').select('role').eq('id',auth.user.id).maybeSingle()
  ]);
  if(!registrar&&!['registrar','admin'].includes(String(actor?.role||'').toLowerCase())) return res.status(403).json({error:'Registrar permission is required.'});
  const accountId=String(req.body?.student_id||req.body?.tutor_id||''); const accountType=req.body?.tutor_id?'tutor':'student'; const suspended=req.body?.suspended;
  if(!accountId||typeof suspended!=='boolean') return res.status(400).json({error:'Account and access state are required.'});
  const {data:target,error:targetError}=await db.from('profiles').select('id,role').eq('id',accountId).maybeSingle();
  const role=String(target?.role||'').toLowerCase();
  const validRoles=accountType==='tutor'?['tutor','teacher']:['student','pending_student'];
  if(targetError||!target||!validRoles.includes(role)) return res.status(404).json({error:accountType==='tutor'?'Approved tutor account not found.':'Student account not found.'});
  if(accountType==='tutor'&&role==='teacher') { /* legacy teacher role is supported */ }
  const {error}=await db.from('profiles').update({access_suspended:suspended}).eq('id',accountId);
  if(error){console.error('Account access update failed:',error.message);return res.status(500).json({error:'Could not update access. Confirm the access_suspended SQL migration has been applied.'});}
  return res.status(200).json({ok:true,account_type:accountType,account_id:accountId,suspended});
};
