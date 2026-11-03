
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, private");

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const {
      SUPABASE_URL,
      SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY,
      META_APP_SECRET
    } = process.env;

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY ||
        !SUPABASE_SERVICE_ROLE_KEY || !META_APP_SECRET) {
      return res.status(500).json({
        error: "Server configuration is incomplete. Check the required Vercel environment variables."
      });
    }

    const authHeader = req.headers.authorization || "";
    const sessionToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : "";

    if (!sessionToken) {
      return res.status(401).json({ error: "Please sign in again." });
    }

    const { createClient } = require("@supabase/supabase-js");

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { data: userData, error: userError } =
      await authClient.auth.getUser(sessionToken);

    if (userError || !userData.user) {
      return res.status(401).json({ error: "Your session is invalid or expired. Please sign in again." });
    }

    const userId = userData.user.id;

    const adminClient = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );

    const [registrarResult, profileResult] = await Promise.all([
      adminClient.from("registrars")
        .select("user_id")
        .eq("user_id", userId)
        .maybeSingle(),
      adminClient.from("profiles")
        .select("role")
        .eq("id", userId)
        .maybeSingle()
    ]);

    const isRegistrar = !!registrarResult.data;
    const isAdmin = ["registrar", "admin"].includes(
      profileResult.data?.role
    );

    if (registrarResult.error || profileResult.error) {
      return res.status(500).json({ error: "Could not verify your registrar permissions." });
    }

    if (!isRegistrar && !isAdmin) {
      return res.status(403).json({ error: "Only a registrar or administrator can perform this action." });
    }

    const userAccessToken = req.body?.user_access_token;

    if (typeof userAccessToken !== "string" ||
        userAccessToken.length < 20 ||
        userAccessToken.length > 10000) {
      return res.status(400).json({ error: "A valid Facebook User Access Token is required." });
    }

    const appId = "1127812599647763";

    const exchangeUrl = new URL("https://graph.facebook.com/v24.0/oauth/access_token");
    exchangeUrl.pathname = "/oauth/access_token";
    exchangeUrl.search = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: META_APP_SECRET,
      fb_exchange_token: userAccessToken
    }).toString();

    const exchangeResponse = await fetch(exchangeUrl.toString());
    const exchangeData = await exchangeResponse.json();

    if (!exchangeResponse.ok || !exchangeData.access_token) {
      return res.status(400).json({
        error: exchangeData.error?.message || "Meta could not exchange the User Access Token."
      });
    }

    const accountsUrl = new URL("https://graph.facebook.com/me/accounts");
    accountsUrl.search = new URLSearchParams({
      fields: "id,name,access_token",
      limit: "100",
      access_token: exchangeData.access_token
    }).toString();

    const accountsResponse = await fetch(accountsUrl.toString());
    const accountsData = await accountsResponse.json();

    if (!accountsResponse.ok) {
      return res.status(400).json({
        error: accountsData.error?.message || "Could not retrieve your Facebook Pages."
      });
    }

    const targetPage = (accountsData.data || []).find(
      page => page.id === "1106362315902155"
    );

    if (!targetPage?.access_token) {
      return res.status(404).json({
        error: "The Sprachenschule Facebook Page was not returned. Check that you selected the correct Page and granted the required permissions."
      });
    }

    return res.status(200).json({
      success: true,
      page_name: targetPage.name,
      page_id: targetPage.id,
      page_access_token: targetPage.access_token
    });
  } catch (error) {
    console.error("Meta token exchange failed:", error.message);
    return res.status(500).json({
      error: "The secure token exchange failed. Check the Vercel deployment logs."
    });
  }
};
