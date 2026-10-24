// Single-active-device lease. Requires supabase-schema.sql to be applied.
(async()=>{
  if(!window.supabase||!window.SUPABASE_URL||!window.SUPABASE_ANON_KEY)return;
  const sb=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
  const {data:{session}}=await sb.auth.getSession();
  if(!session)return;
  let sid=localStorage.getItem('ssg_session_id');
  if(!sid){sid=crypto.randomUUID();const c=await sb.rpc('acquire_student_session',{p_session_id:sid});if(c.error||c.data!==true){await sb.auth.signOut({scope:'local'});location.href='school.html';return}localStorage.setItem('ssg_session_id',sid)}
  const beat=async()=>{const r=await sb.rpc('heartbeat_student_session',{p_session_id:sid});if(r.error||r.data!==true){localStorage.removeItem('ssg_session_id');await sb.auth.signOut({scope:'local'});alert('Your account session is no longer active on this device. Please sign in again.');location.href='school.html'}};
  await beat();
  const timer=setInterval(beat,30000);
  window.addEventListener('pagehide',()=>clearInterval(timer));
})();
