(() => {
'use strict';
const $ = id => document.getElementById(id);
const supabase = window.supabase?.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const state = {
 user:null, profile:null, classInfo:null, role:null, clientId:crypto.randomUUID(),
 channel:null, peers:new Map(), participants:new Map(), streams:new Map(),
 localVideo:null, localAudio:null, screenTrack:null, screenSharers:new Set(), micOn:false, camOn:false,
 tutorPresent:false, studentsMuted:false, tutorMutedAll:false, hands:new Set(), heartbeatTimer:null,
 rosterTimer:null, signalsSub:null, joinedAt:null, activeMaterialId:null, activeMaterialUrl:null, activeMaterialUrlExpiresAt:0, presentationType:null,
 pdf:null, pdfScale:.25, pdfPage:1, pdfRenderToken:0, mediaElement:null,
 attendanceId:null, recording:null, leaving:false
};
const rtcConfig={iceTransportPolicy:'all',iceServers:[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'}]};
async function configureTurnRelay(){
 try{
  const hint=$('networkHint');
  if(hint)hint.textContent='Preparing secure media relay credentials…';
  const session=await getSession();
  const response=await fetch('/api/classroom-turn-credentials',{
   method:'POST',
   headers:{'Content-Type':'application/json','Authorization':'Bearer '+session.access_token},
   body:JSON.stringify({class_id:state.classInfo.id}),
   cache:'no-store'
  });
  if(!response.ok){
   let detail='TURN credential service returned HTTP '+response.status+'.';
   try{const body=await response.json();if(body?.error)detail=body.error+' (HTTP '+response.status+').';}catch{}
   throw new Error(detail);
  }
  const data=await response.json();
  if(!Array.isArray(data.iceServers)||!data.iceServers.length)throw new Error('TURN server list was empty.');
  rtcConfig.iceServers=data.iceServers;
  console.info('[CLASSROOM] Cloudflare TURN credentials loaded; direct connections remain preferred.');
  if(hint)hint.textContent='Cloudflare TURN is configured. Direct browser connections are preferred; the relay is available automatically when a direct route is blocked.';
  return true;
 }catch(error){
  console.warn('[CLASSROOM] TURN relay unavailable; continuing with STUN direct connectivity.',error.message);
  const hint=$('networkHint');
  if(hint)hint.textContent='TURN setup failed: '+error.message+' Media may fail on restrictive networks. Please contact the school administrator.';
  rtcConfig.iceServers=[{urls:'stun:stun.cloudflare.com:3478'},{urls:'stun:stun.l.google.com:19302'},{urls:'stun:stun1.l.google.com:19302'}];
  return false;
 }
}
const isTutor=()=>['tutor','teacher'].includes(state.role);
const isStaff=()=>['registrar','admin'].includes(state.role);
const isStudent=()=>state.role==='student';
const safeText=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function status(message,type=''){ $('status').textContent=message; $('status').className='status '+type; }
function roomStatus(message){$('micNote').textContent=message;}
function sendSignal(type,payload,recipient=null){
 if(!state.classInfo)return Promise.resolve();
 return supabase.from('classroom_signals').insert({class_id:state.classInfo.id,sender_id:state.user.id,recipient_id:recipient,signal_type:type,payload}).then(({error})=>{if(error)console.warn('Class signal failed',error.message);});
}
async function getSession(){const {data:{session},error}=await supabase.auth.getSession();if(error||!session)throw new Error('Please sign in with your Sprachenschule account first.');return session;}
async function initialize(){
 $('year').textContent=new Date().getFullYear();
 const params=new URLSearchParams(location.search);$('roomName').value=params.get('name')||params.get('room')||'';
 $('menuToggle').addEventListener('click',()=>{const nav=$('primaryNav');const open=nav.classList.toggle('mobile-open');$('menuToggle').setAttribute('aria-expanded',String(open));});
 $('logoutBtn').addEventListener('click',async()=>{await supabase.auth.signOut();location.href='school.html';});
 try{
  if(!supabase)throw new Error('The school sign-in service is not configured.');
  await getSession();
  const {data:{user},error}=await supabase.auth.getUser();if(error||!user)throw new Error('Please sign in again.');
  state.user=user;
  const {data:profile,error:profileError}=await supabase.from('profiles').select('id,email,full_name,role,access_approved,access_expires_at,access_suspended').eq('id',user.id).maybeSingle();
  if(profileError||!profile)throw new Error('Your school profile could not be loaded.');
  state.profile=profile;
  $('displayName').value=profile.full_name||user.email?.split('@')[0]||'Participant';
  if(!['student','tutor','teacher','registrar','admin'].includes(profile.role))throw new Error('Your account is not authorised to enter the classroom.');
  if(profile.role==='student'&&(!profile.access_approved||profile.access_suspended||(!profile.access_expires_at||new Date(profile.access_expires_at)<=new Date())))throw new Error('Your student access is not currently active. Please contact the school.');
  $('dashboardLink').href=profile.role==='tutor'||profile.role==='teacher'?'teacher.html':'dashboard.html';
  $('backDashboardBtn').href=$('dashboardLink').href;
  status('Signed in. Enter the classroom name from your scheduled lesson.','ok');
  if(params.get('class')||params.get('room')) $('joinForm').requestSubmit();
 }catch(e){status(e.message,'error');if(/sign in|signed in/i.test(e.message))setTimeout(()=>location.href='school.html',1500);}
}
async function joinClass(event){
 event?.preventDefault();if(!supabase||state.classInfo)return;
 const classroomName=$('roomName').value.trim(),displayName=$('displayName').value.trim();
 const params=new URLSearchParams(location.search),classId=params.get('class');
 if(!classroomName||!displayName){status('Enter the classroom name and your display name.','error');return;}
 $('joinBtn').disabled=true;status('Checking your scheduled class and connecting…');
 try{
  await getSession();
  let c=null;
  if(classId){
   const result=await supabase.rpc('classroom_get_scheduled_class',{p_class_id:classId,p_title:null,p_room_name:null});
   if(result.error)throw new Error(result.error.message);
   if(result.data?.length>1)throw new Error('The scheduled class lookup returned more than one result.');
   c=result.data?.[0]||null;
  }else{
   const byTitle=await supabase.rpc('classroom_get_scheduled_class',{p_class_id:null,p_title:classroomName,p_room_name:null});
   if(byTitle.error)throw new Error(byTitle.error.message);
   if(byTitle.data?.length===1)c=byTitle.data[0];
   else if(byTitle.data?.length>1)throw new Error('More than one scheduled lesson has that classroom name. Please open the specific lesson from your dashboard.');
   else{
    const legacy=await supabase.rpc('classroom_get_scheduled_class',{p_class_id:null,p_title:null,p_room_name:classroomName});
    if(legacy.error)throw new Error(legacy.error.message);
    if(legacy.data?.length===1)c=legacy.data[0];
    else if(legacy.data?.length>1)throw new Error('More than one scheduled lesson uses that room name. Please open the specific lesson from your dashboard.');
   }
  }
  if(!c)throw new Error('This scheduled classroom could not be found or is not available to your account. Check that you are enrolled, assigned to the lesson, and within its scheduled join window.');
  const {data:lease,error:joinError}=await supabase.rpc('classroom_join',{p_class_id:c.id,p_client_id:state.clientId});
  if(joinError)throw new Error(joinError.message);
  state.classInfo=c;state.role=lease.role;state.tutorPresent=!!lease.tutor_present;state.joinedAt=new Date().toISOString();
  await configureTurnRelay();
  $('roomTitle').textContent=c.title||roomName.replace(/[-_]/g,' ');
  $('joinCard').classList.add('hidden');$('roomArea').classList.remove('hidden');
  $('shareBtn').classList.toggle('hidden',!isTutor());
  $('muteAllBtn').classList.toggle('hidden',!isTutor());
  $('clearHandsBtn').classList.toggle('hidden',!isTutor());
  $('recordBtn').classList.toggle('hidden',!isTutor());
  $('backDashboardBtn').textContent=isTutor()?'← Tutor dashboard':'← Student dashboard';
  status('Connected to the authorised class.','ok');
  await startLocalMedia();
  await insertAttendance();
  await subscribeSignals();
  await loadMuteState();
  await subscribeLeases();
  await refreshParticipants();
  await loadMaterials();
  await loadRecordings();
  state.heartbeatTimer=setInterval(heartbeat,12000);
  state.rosterTimer=setInterval(refreshParticipants,8000);
  heartbeat();
 }catch(e){status(e.message,'error');if(state.classInfo)await leaveClass(false);}
 finally{$('joinBtn').disabled=false;}
}
async function startLocalMedia(){
 try{
  const constraints={audio:false,video:{width:{ideal:640,max:960},height:{ideal:360,max:540},frameRate:{ideal:18,max:24}}};
  const stream=await navigator.mediaDevices.getUserMedia(constraints);
  state.localVideo=stream.getVideoTracks()[0]||null;
  if(state.localVideo){state.localVideo.enabled=true;state.camOn=true;addLocalTile();}
 }catch(e){console.warn('Camera unavailable',e);roomStatus('Camera unavailable. You can still join by audio.');}
 if(isTutor()){
  try{const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});state.localAudio=stream.getAudioTracks()[0];state.micOn=!!state.localAudio;}
  catch(e){roomStatus('Tutor microphone unavailable. Check browser microphone permission.');}
 }else{state.micOn=false;roomStatus(state.tutorPresent?'Tutor is present. Your microphone is off until you choose to unmute.':'Student microphones are disabled until the assigned tutor joins.');}
 updateControlButtons();
}
function addLocalTile(){
 let tile=document.getElementById('tile-'+state.user.id);if(!tile){tile=makeTile(state.user.id,state.profile.full_name||'You');}
 const video=document.createElement('video');video.autoplay=true;video.muted=true;video.playsInline=true;video.srcObject=new MediaStream([state.localVideo]);tile.prepend(video);
}
function makeTile(id,name){
 let tile=document.getElementById('tile-'+id);if(tile)return tile;
 tile=document.createElement('div');tile.className='video-tile';tile.id='tile-'+id;
 const avatar=document.createElement('div');avatar.className='avatar';avatar.textContent=(name||'?').trim().slice(0,1).toUpperCase();
 const label=document.createElement('span');label.className='tile-name';label.textContent=name||'Participant';
 tile.append(avatar,label);$('videoGrid').append(tile);return tile;
}
function removeTile(id){document.getElementById('tile-'+id)?.remove();}
function updateControlButtons(){
 $('micBtn').classList.toggle('is-active',state.micOn);$('micBtn').classList.toggle('is-inactive',!state.micOn);
 $('micBtn').setAttribute('aria-pressed',String(state.micOn));$('micBtn').setAttribute('aria-label',state.micOn?'Mute microphone':'Unmute microphone');
 $('micBtn').disabled=isStudent()&&(!state.tutorPresent||state.studentsMuted);
 $('camBtn').classList.toggle('is-active',state.camOn);$('camBtn').classList.toggle('is-inactive',!state.camOn);
 $('camBtn').setAttribute('aria-pressed',String(state.camOn));$('camBtn').setAttribute('aria-label',state.camOn?'Turn camera off':'Turn camera on');
 $('participantCount').textContent=state.participants.size+' / 7';
}
async function setMic(enabled){
 if(enabled&&isStudent()&&(!state.tutorPresent||state.studentsMuted)){roomStatus('No host present');return;}
 if(enabled===state.micOn)return;
 if(enabled){
  try{
   // Students request microphone access only after they deliberately press Unmute.
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
   const track=stream.getAudioTracks()[0];
   // The tutor may have left while the browser permission prompt was open.
   if(isStudent()&&(!state.tutorPresent||state.studentsMuted)){
    track?.stop();stream.getTracks().forEach(t=>t.stop());state.localAudio=null;state.micOn=false;
    roomStatus('No host present');updateControlButtons();return;
   }
   state.localAudio=track;state.micOn=!!track;
   if(track){
    for(const [id,peer] of state.peers){peer.pc.addTrack(track,new MediaStream([track]));}
    addRecordingLocalAudio(track);
   }
  }catch(e){roomStatus('Microphone permission was not granted or no microphone is available.');return;}
 }else{
  // Stop and detach the outgoing audio track immediately when muted or when the host leaves.
  const track=state.localAudio;state.localAudio=null;state.micOn=false;
  if(track){track.enabled=false;track.stop();}
  for(const [id,peer] of state.peers){peer.pc.getSenders().filter(s=>s.track?.kind==='audio').forEach(s=>peer.pc.removeTrack(s));}
 }
 updateControlButtons();
}
async function setCamera(enabled){
 if(enabled===state.camOn)return;
 if(enabled){try{const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640,max:960},height:{ideal:360,max:540},frameRate:{ideal:18,max:24}},audio:false});state.localVideo=stream.getVideoTracks()[0];state.camOn=true;
   const tile=document.getElementById('tile-'+state.user.id)||makeTile(state.user.id,'You');const v=document.createElement('video');v.autoplay=true;v.muted=true;v.playsInline=true;v.srcObject=new MediaStream([state.localVideo]);tile.prepend(v);
   for(const [id,peer] of state.peers)peer.pc.addTrack(state.localVideo,new MediaStream([state.localVideo]));
  }catch(e){roomStatus('Camera permission was not granted or no camera is available.');return;}
 }else{state.localVideo?.stop();state.localVideo=null;state.camOn=false;document.querySelectorAll('#tile-'+state.user.id+' video').forEach(v=>v.remove());for(const [id,peer] of state.peers)peer.pc.getSenders().filter(s=>s.track?.kind==='video'&&s.track!==state.screenTrack).forEach(s=>peer.pc.removeTrack(s));}
 updateControlButtons();
}
async function toggleShare(){
 if(!isTutor())return;
 if(state.screenTrack){state.screenTrack.stop();state.screenTrack=null;return;}
 try{
  const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:15,max:20}},audio:true});
  state.screenTrack=stream.getVideoTracks()[0];state.presentationType='screen';
  const stageVideo=document.createElement('video');stageVideo.autoplay=true;stageVideo.muted=true;stageVideo.playsInline=true;stageVideo.srcObject=new MediaStream([state.screenTrack]);showStage(stageVideo,'Tutor screen share');
  for(const [id,peer] of state.peers)peer.pc.addTrack(state.screenTrack,new MediaStream([state.screenTrack]));
  state.screenTrack.onended=()=>stopShare();
  await sendSignal('screen-state',{active:true});
 }catch(e){roomStatus('Screen sharing was cancelled or is not supported by this browser.');}
}
async function stopShare(){
 if(!state.screenTrack)return;const track=state.screenTrack;state.screenTrack=null;state.presentationType=null;track.stop();
 for(const [id,peer] of state.peers)peer.pc.getSenders().filter(s=>s.track===track).forEach(s=>peer.pc.removeTrack(s));
 await sendSignal('screen-state',{active:false});
 $('presentationStage').replaceChildren(emptyStage());
}
function emptyStage(){const d=document.createElement('div');d.className='stage-empty';d.innerHTML='<div class="stage-empty-icon">◫</div><strong>Your lesson stage</strong><span>Your tutor’s screen or lesson material will appear here.</span>';return d;}
function showStage(node,title){const stage=$('presentationStage');stage.replaceChildren(node);const label=document.createElement('div');label.className='material-title';label.textContent=title;stage.append(label);}
async function updateConnectionPath(pc){
 if(!pc||!['connected','completed'].includes(pc.iceConnectionState))return;
 try{
  const stats=await pc.getStats();let pair=null;
  stats.forEach(report=>{
   if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId)||pair;
   if(report.type==='candidate-pair'&&(report.selected||(report.nominated&&report.state==='succeeded')))pair=report;
  });
  if(!pair)return;
  const local=stats.get(pair.localCandidateId),remote=stats.get(pair.remoteCandidateId);
  const viaRelay=local?.candidateType==='relay'||remote?.candidateType==='relay';
  $('connectionState').textContent=viaRelay?'● Connected · TURN relay':'● Connected · Direct';
  const hint=$('networkHint');
  if(hint)hint.textContent=viaRelay?'Media is flowing through Cloudflare TURN relay.':'Media is using a direct browser connection. Cloudflare TURN remains available as a fallback.';
 }catch(error){console.debug('Could not inspect selected ICE route.',error);}
}
function createPeer(id){
 if(state.peers.has(id))return state.peers.get(id);
 const pc=new RTCPeerConnection(rtcConfig),peer={pc,polite:state.user.id.localeCompare(id)>0,makingOffer:false,ignoreOffer:false,isSettingRemoteAnswerPending:false,pendingCandidates:[]};
 state.peers.set(id,peer);
 if(state.localVideo)pc.addTrack(state.localVideo,new MediaStream([state.localVideo]));
 if(state.localAudio)pc.addTrack(state.localAudio,new MediaStream([state.localAudio]));
 if(state.screenTrack)pc.addTrack(state.screenTrack,new MediaStream([state.screenTrack]));
 pc.onicecandidate=e=>{if(e.candidate)sendSignal('ice',{candidate:e.candidate.toJSON()},id);};
 pc.ontrack=e=>{
  // A remote track may arrive just before the next roster refresh. Preserve it;
  // participant metadata is not required to attach the media element.
  const participant=state.participants.get(id)||{full_name:'Participant',role:'unknown'};
  const track=e.track;
  if(track.kind==='audio'){
   if(participant.role==='student'&&(!state.tutorPresent||state.studentsMuted)){track.enabled=false;return;}
   let audio=document.getElementById('audio-'+id);if(!audio){audio=document.createElement('audio');audio.id='audio-'+id;audio.autoplay=true;audio.playsInline=true;audio.style.display='none';document.body.append(audio);}
   audio.srcObject=e.streams[0]||new MediaStream([track]);audio.play().catch(()=>roomStatus('Tap the page once to enable classroom sound.'));
  }else if(track.kind==='video'){
   const video=document.createElement('video');video.autoplay=true;video.playsInline=true;video.srcObject=e.streams[0]||new MediaStream([track]);
   if(state.screenSharers.has(id)){showStage(video,'Tutor screen share');track.addEventListener('ended',()=>{if(state.screenSharers.has(id))$('presentationStage').replaceChildren(emptyStage());});}
   else {const tile=makeTile(id,participant.full_name);const previous=tile.querySelector('video');if(previous)previous.remove();tile.prepend(video);}
  }
 };
 pc.onconnectionstatechange=()=>{const s=pc.connectionState;if(s==='failed'||s==='disconnected'){$('connectionState').textContent='● Reconnecting';}else if(s==='connected'){updateConnectionPath(pc);}};
 pc.oniceconnectionstatechange=()=>{if(['connected','completed'].includes(pc.iceConnectionState))updateConnectionPath(pc);};
 pc.onnegotiationneeded=async()=>{await renegotiate(id);};
 return peer;
}
async function renegotiate(id){
 const peer=state.peers.get(id);if(!peer||peer.pc.signalingState==='closed')return;
 try{peer.makingOffer=true;await peer.pc.setLocalDescription();await sendSignal(peer.pc.localDescription.type,{description:peer.pc.localDescription},id);}
 catch(e){console.warn('Negotiation failed',e);}finally{peer.makingOffer=false;}
}
async function handleSignal(row){
 if(row.sender_id===state.user.id)return;
 if(row.recipient_id&&row.recipient_id!==state.user.id)return;
 const p=row.payload||{};
 if(['offer','answer','ice'].includes(row.signal_type)){
  const peer=createPeer(row.sender_id),pc=peer.pc;
  try{
   if(row.signal_type==='ice'){if(p.candidate){if(pc.remoteDescription)await pc.addIceCandidate(p.candidate);else peer.pendingCandidates.push(p.candidate);}return;}
   const description=p.description;if(!description)return;
   const readyForOffer=!peer.makingOffer&&(pc.signalingState==='stable'||peer.isSettingRemoteAnswerPending);
   const offerCollision=description.type==='offer'&&!readyForOffer;
   peer.ignoreOffer=!peer.polite&&offerCollision;if(peer.ignoreOffer)return;
   peer.isSettingRemoteAnswerPending=description.type==='answer';
   await pc.setRemoteDescription(description);peer.isSettingRemoteAnswerPending=false;
   for(const candidate of peer.pendingCandidates.splice(0)){try{await pc.addIceCandidate(candidate);}catch(e){console.warn('Queued ICE candidate was rejected.',e);}}
   if(description.type==='offer'){await pc.setLocalDescription();await sendSignal('answer',{description:pc.localDescription},row.sender_id);}
  }catch(e){console.warn('Signal negotiation event ignored',e);}
  return;
 }
 handleClassEvent(row.signal_type,p,row.sender_id);
}
function handleClassEvent(type,p,sender){
 const person=state.participants.get(sender);
 if(type==='chat')addChat(person?.full_name||'Participant',p.message);
 if(type==='clap')showClap(sender);
 if(type==='hand'){if(p.raised)state.hands.add(sender);else state.hands.delete(sender);renderHands();}
 if(type==='hand-clear'&&isTutor()){state.hands.clear();renderHands();}
 if(type==='mute-all'&&isStudent()){state.studentsMuted=!!p.muted;if(state.studentsMuted){setMic(false);roomStatus('The tutor has muted student microphones.');}else{roomStatus('The tutor has reopened student microphones.');}for(const [id,participant] of state.participants){if(participant.role==='student'){const audio=document.getElementById('audio-'+id);if(audio){if(state.studentsMuted)audio.pause();else audio.play().catch(()=>{});}}}updateControlButtons();}
 if(type==='screen-state'&&!isTutor()){if(p.active){state.screenSharers.add(sender);const existing=document.getElementById('tile-'+sender)?.querySelector('video');if(existing){existing.remove();showStage(existing,'Tutor screen share');}}else{state.screenSharers.delete(sender);$('presentationStage').replaceChildren(emptyStage());}}
 if(type==='material-open'&&p.id)openMaterial(p.id,false,null,p.url,p.expiresAt);
 if(type==='pdf-view'&&p.id===state.activeMaterialId)goPdfPage(p.page,false,p.scale);
 if(type==='material-control'&&p.id===state.activeMaterialId)applyMaterialControl(p);
}
function addChat(name,message){const log=$('chatLog');if(log.querySelector('.muted'))log.replaceChildren();const div=document.createElement('div');div.className='chat-message';const strong=document.createElement('strong');strong.textContent=name;const body=document.createElement('span');body.textContent=message;div.append(strong,body);log.append(div);log.scrollTop=log.scrollHeight;}
function showClap(sender){
 const stage=$('presentationStage');
 if(!stage)return;
 const el=document.createElement('span');
 el.className='clap-float';
 el.textContent='👏';
 el.setAttribute('aria-hidden','true');
 el.style.left=(14+Math.random()*72)+'%';
 stage.append(el);
 el.addEventListener('animationend',()=>el.remove(),{once:true});
 setTimeout(()=>el.remove(),2600);
}
function renderHands(){document.querySelectorAll('.raised-hand-indicator').forEach(n=>n.remove());for(const id of state.hands){const tile=document.getElementById('tile-'+id);if(tile){const el=document.createElement('span');el.className='raised-hand-indicator';el.textContent='✋';tile.append(el);}}$('raisedHandCount').textContent=state.hands.size;}
async function refreshParticipants(){
 if(!state.classInfo)return;
 const {data,error}=await supabase.rpc('classroom_active_participants',{p_class_id:state.classInfo.id});
 if(error){console.warn('Participant list unavailable',error.message);return;}
 const previous=state.participants;
 const next=new Map((data||[]).map(p=>[p.user_id,p]));
 state.participants=next;
 for(const [id,p] of next){
  if(id===state.user.id)continue;
  makeTile(id,p.full_name);
  if(!state.peers.has(id))createPeer(id);
  // A student who joins after the tutor began presenting missed the original
  // Realtime event. Replay the current presentation state directly to that student.
  if(isTutor()&&p.role==='student'&&!previous.has(id)){
   if(state.presentationType==='screen'&&state.screenTrack)void sendSignal('screen-state',{active:true},id);
   else if(state.presentationType==='material'&&state.activeMaterialId){
    if(isTutor()&&state.activeMaterialUrl&&state.activeMaterialUrlExpiresAt>Date.now()+60000)void sendSignal('material-open',{id:state.activeMaterialId,url:state.activeMaterialUrl,expiresAt:state.activeMaterialUrlExpiresAt},id);
    else if(isTutor())void openMaterial(state.activeMaterialId,true,id);
   }
  }
 }
 for(const id of [...state.peers.keys()])if(!next.has(id)){state.peers.get(id).pc.close();state.peers.delete(id);removeTile(id);document.getElementById('audio-'+id)?.remove();state.hands.delete(id);}
 $('participants').innerHTML=[...next.values()].map(p=>'<div class="participant-row"><span>'+safeText(p.full_name)+(p.user_id===state.user.id?' (you)':'')+'</span><span class="participant-role">'+(p.user_id===state.classInfo.teacher_id?'Assigned tutor':p.role==='student'?'Student':safeText(p.role))+'</span></div>').join('')||'No participants';
 $('attendanceList').innerHTML=[...next.values()].map(p=>'<span class="attendance-person"><i class="attendance-dot"></i>'+safeText(p.full_name)+'</span>').join('');
 $('attendanceCount').textContent=next.size+' present';$('participantCount').textContent=next.size+' / 7';
 const tutor=next.has(state.classInfo.teacher_id);
 updateTutorPresence(tutor);
 
}
function updateTutorPresence(present){
 const changed=state.tutorPresent!==present;state.tutorPresent=present;
 if(isStudent()){
  if(!present){state.studentsMuted=true;void setMic(false);roomStatus('No host present');}
  else if(changed){state.studentsMuted=false;roomStatus('Tutor is present. Your microphone is off until you choose to unmute.');}
  else if(!state.studentsMuted){roomStatus('Tutor is present. Your microphone is off until you choose to unmute.');}
  updateControlButtons();
 }
 if(changed)for(const [id,p] of state.participants){const audio=document.getElementById('audio-'+id);if(audio&&p.role==='student'){if(present&&!state.studentsMuted)audio.play().catch(()=>{});else audio.pause();}}
}
async function loadMuteState(){
 const {data,error}=await supabase.from('classroom_signals').select('payload').eq('class_id',state.classInfo.id).eq('signal_type','mute-all').order('created_at',{ascending:false}).limit(1).maybeSingle();
 if(!error&&data?.payload){state.studentsMuted=!!data.payload.muted;state.tutorMutedAll=!!data.payload.muted;}
 if(isStudent()&&!state.tutorPresent)state.studentsMuted=true;
 updateControlButtons();
}
async function subscribeSignals(){
 state.channel=supabase.channel('classroom-signals-'+state.classInfo.id);
 state.channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'classroom_signals',filter:'class_id=eq.'+state.classInfo.id},payload=>handleSignal(payload.new));
 const result=await new Promise(resolve=>state.channel.subscribe(s=>{if(s==='SUBSCRIBED')resolve(true);if(s==='CHANNEL_ERROR'||s==='TIMED_OUT')resolve(false);}));
 if(!result)throw new Error('Secure classroom signalling could not connect. Check Realtime is enabled for this project.');
}
async function subscribeLeases(){
 state.leaseChannel=supabase.channel('classroom-presence-'+state.classInfo.id);
 state.leaseChannel.on('postgres_changes',{event:'*',schema:'public',table:'classroom_participant_leases',filter:'class_id=eq.'+state.classInfo.id},()=>refreshParticipants());
 await new Promise(resolve=>state.leaseChannel.subscribe(s=>{if(s==='SUBSCRIBED'||s==='CHANNEL_ERROR'||s==='TIMED_OUT')resolve();}));
}
async function heartbeat(){
 if(state.leaving||!state.classInfo)return;
 const {data,error}=await supabase.rpc('classroom_heartbeat',{p_class_id:state.classInfo.id,p_client_id:state.clientId});
 if(error){if(isStudent()){state.studentsMuted=true;await setMic(false);}roomStatus('Classroom access could not be renewed. Your microphone is disabled.');await leaveClass(true);return;}
 updateTutorPresence(!!data.tutor_present);
 if(data.participant_count>7){await leaveClass(true);return;}
}
async function insertAttendance(){
 if(!isStudent())return;
 const {data,error}=await supabase.from('class_attendance').insert({class_id:state.classInfo.id,student_id:state.user.id,attendance_status:'present',notes:'Joined virtual classroom'}).select('id').maybeSingle();
 if(!error&&data)state.attendanceId=data.id;
}
async function closeAttendance(){
 if(!state.attendanceId)return;
 await supabase.from('class_attendance').update({left_at:new Date().toISOString()}).eq('id',state.attendanceId);
}
async function loadMaterials(){
 const {data,error}=await supabase.from('class_materials').select('id,title,material_type,is_hidden,storage_path,created_at').eq('class_id',state.classInfo.id).is('deleted_at',null).order('created_at',{ascending:false});
 if(error){$('classMaterials').textContent='Materials could not be loaded: '+error.message;return;}
 const visible=(data||[]).filter(m=>isTutor()||!m.is_hidden);
 if(!visible.length){$('classMaterials').textContent='No materials are available yet.';return;}
 $('classMaterials').replaceChildren();
 visible.forEach(m=>{const row=document.createElement('div');row.className='material-row';const title=document.createElement('strong');title.textContent=m.title;const meta=document.createElement('div');meta.className='hint';meta.textContent=m.material_type+(m.is_hidden&&isTutor()?' · Hidden from students':'');row.append(title,meta);if(isTutor()){const btn=document.createElement('button');btn.className='btn btn-primary';btn.type='button';btn.textContent='Open on meeting screen';btn.addEventListener('click',()=>openMaterial(m.id,true));row.append(btn);} $('classMaterials').append(row);});
}
async function openMaterial(id,broadcast,recipient=null,sharedUrl=null,sharedExpiresAt=0){
 const {data:m,error}=await supabase.from('class_materials').select('id,class_id,title,material_type,storage_path').eq('id',id).is('deleted_at',null).maybeSingle();
 if(error||!m||m.class_id!==state.classInfo.id){roomStatus('This material is unavailable for this class.');return;}
 let url=sharedUrl, expiresAt=Number(sharedExpiresAt)||0;
 if(isTutor()){
  if(state.activeMaterialId===m.id&&state.activeMaterialUrl&&state.activeMaterialUrlExpiresAt>Date.now()+60000){url=state.activeMaterialUrl;expiresAt=state.activeMaterialUrlExpiresAt;}
  else if(!url||expiresAt<=Date.now()+60000){
   const {data:link,error:linkError}=await supabase.storage.from('class-materials').createSignedUrl(m.storage_path,3600);
   if(linkError||!link?.signedUrl){roomStatus('The material could not be opened.');return;}
   url=link.signedUrl;expiresAt=Date.now()+3600000;
  }
 }else if(!url||expiresAt<=Date.now()+15000){
  const {data:link,error:linkError}=await supabase.storage.from('class-materials').createSignedUrl(m.storage_path,3600);
  if(linkError||!link?.signedUrl){roomStatus('The material could not be opened.');return;}
  url=link.signedUrl;expiresAt=Date.now()+3600000;
 }
 if(!url){roomStatus('The material could not be opened.');return;}
 if(state.activeMaterialId===m.id&&state.activeMaterialUrl===url&&state.presentationType==='material')return;
 state.activeMaterialId=m.id;state.activeMaterialUrl=url;state.activeMaterialUrlExpiresAt=expiresAt;state.presentationType='material';
 if(broadcast)await sendSignal('material-open',{id:m.id,url,expiresAt},recipient);
 state.pdf=null;state.pdfRenderToken++;
 const stage=$('presentationStage');stage.replaceChildren();
 if(m.material_type==='audio'||m.material_type==='video'){
  const media=document.createElement(m.material_type);media.src=url;media.controls=isTutor();media.autoplay=false;media.playsInline=true;
  media.style.width='100%';media.style.height='100%';media.style.objectFit='contain';media.id='presentedMedia';stage.append(media);state.mediaElement=media;
  if(isTutor()){media.addEventListener('play',()=>sendSignal('material-control',{id:m.id,action:'play',time:media.currentTime}));media.addEventListener('pause',()=>sendSignal('material-control',{id:m.id,action:'pause',time:media.currentTime}));media.addEventListener('seeked',()=>sendSignal('material-control',{id:m.id,action:'seek',time:media.currentTime}));}
 }else if((m.storage_path||'').toLowerCase().split('?')[0].endsWith('.pdf')){
  await renderPdfMaterial(url,m.title,isTutor());
 }else{
  const pre=document.createElement('pre');pre.textContent='Loading notes…';stage.append(pre);try{const response=await fetch(url);if(!response.ok)throw new Error('Download failed');pre.textContent=await response.text();}catch{pre.textContent='These notes could not be displayed.';}
 }
}
async function renderPdfMaterial(url,title,leader){
 const stage=$('presentationStage');stage.replaceChildren();
 const toolbar=document.createElement('div');toolbar.className='material-toolbar';
 const content=document.createElement('div');content.className='material-content';
 const scroll=document.createElement('div');scroll.className='pdf-scroll';const pages=document.createElement('div');pages.className='pdf-pages';scroll.append(pages);content.append(scroll);stage.append(toolbar,content);
 const makeButton=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);toolbar.append(b);};
 makeButton('−',()=>setPdfScale(Math.max(.25,state.pdfScale-.25),true));const z=document.createElement('span');z.textContent='25%';z.style.fontSize='.8rem';toolbar.append(z);
 makeButton('+',()=>setPdfScale(Math.min(3,state.pdfScale+.25),true));makeButton('Fit width',()=>fitPdfWidth(true));makeButton('100%',()=>setPdfScale(1,true));
 const pdfjs=await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');pdfjs.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
 state.pdf=await pdfjs.getDocument({url}).promise;state.pdfScale=.25;state.pdfPage=1;
 const render=async()=>{const token=++state.pdfRenderToken;pages.replaceChildren();for(let n=1;n<=state.pdf.numPages;n++){const page=await state.pdf.getPage(n);if(token!==state.pdfRenderToken)return;const viewport=page.getViewport({scale:state.pdfScale});const ratio=Math.min(Math.max(devicePixelRatio||1,2),3);const canvas=document.createElement('canvas');canvas.className='pdf-page';canvas.width=Math.ceil(viewport.width*ratio);canvas.height=Math.ceil(viewport.height*ratio);canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';pages.append(canvas);await page.render({canvasContext:canvas.getContext('2d',{alpha:false}),viewport,transform:[ratio,0,0,ratio,0,0]}).promise;}z.textContent=Math.round(state.pdfScale*100)+'%';};
 state.renderPdf=render;await render();
 if(leader){let last=0;scroll.addEventListener('scroll',()=>{const els=[...pages.querySelectorAll('canvas')];const ix=els.findIndex(el=>el.getBoundingClientRect().bottom>scroll.getBoundingClientRect().top+15);const page=Math.max(1,ix+1);if(page!==last){last=page;state.pdfPage=page;sendSignal('pdf-view',{id:state.activeMaterialId,page,scale:state.pdfScale});}},{passive:true});}
}
async function setPdfScale(scale,broadcast){state.pdfScale=scale;if(state.renderPdf)await state.renderPdf();if(broadcast&&isTutor())await sendSignal('pdf-view',{id:state.activeMaterialId,page:state.pdfPage,scale});}
async function fitPdfWidth(broadcast){if(!state.pdf)return;const p=await state.pdf.getPage(1);const base=p.getViewport({scale:1});const width=Math.max(120,$('presentationStage').clientWidth-30);await setPdfScale(Math.max(.25,Math.min(3,width/base.width)),broadcast);}
function goPdfPage(page,broadcast,scale){if(!state.pdf)return;if(Number.isFinite(scale)&&Math.abs(scale-state.pdfScale)>.02)setPdfScale(scale,false);state.pdfPage=Math.max(1,Math.min(state.pdf.numPages,Number(page)||1));const canvases=$('presentationStage').querySelectorAll('.pdf-page');const target=canvases[state.pdfPage-1];if(target)target.scrollIntoView({block:'start'});}
function applyMaterialControl(p){const m=state.mediaElement;if(!m||p.id!==state.activeMaterialId)return;if(Number.isFinite(p.time)&&Math.abs(m.currentTime-p.time)>.8)m.currentTime=p.time;if(p.action==='play')m.play().catch(()=>{});if(p.action==='pause')m.pause();}

function addRecordingLocalAudio(track){
 const rec=state.recording;if(!rec||!track)return;
 try{const source=rec.audioCtx.createMediaStreamSource(new MediaStream([track]));source.connect(rec.audioDestination);rec.audioSources.push(source);}catch(e){console.warn('Could not add microphone to recording mix.',e);}
}
function connectRecordingMediaElement(el){
 const rec=state.recording;if(!rec||!el||rec.mediaElements.has(el))return;
 try{
  const source=rec.audioCtx.createMediaElementSource(el);
  source.connect(rec.audioDestination);
  source.connect(rec.audioCtx.destination);
  rec.audioSources.push(source);rec.mediaElements.add(el);
 }catch(e){console.warn('A media element could not be included in the recording audio mix.',e);}
}
async function startRecording(){
 if(!isTutor()||state.recording)return;
 if(!window.MediaRecorder||!HTMLCanvasElement.prototype.captureStream){roomStatus('This browser does not support classroom recording. Try a current version of Chrome or Edge.');return;}
 $('recordBtn').disabled=true;
 let recordingRowId=null;
 try{
  const {data:row,error}=await supabase.from('class_recordings').insert({class_id:state.classInfo.id,requested_by:state.user.id,status:'recording',started_at:new Date().toISOString()}).select('id').single();
  if(error||!row)throw new Error(error?.message||'Could not create the recording record.');
  recordingRowId=row.id;
  const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;
  const ctx=canvas.getContext('2d',{alpha:false});
  const canvasStream=canvas.captureStream(15);
  const audioCtx=new (window.AudioContext||window.webkitAudioContext)();
  await audioCtx.resume();
  const audioDestination=audioCtx.createMediaStreamDestination();
  const audioSources=[],mediaElements=new WeakSet();
  const rec={id:row.id,recorder:null,chunks:[],canvas,ctx,canvasStream,audioCtx,audioDestination,audioSources,mediaElements,startedAt:Date.now(),frame:0,observer:null,finished:null};
  state.recording=rec;
  if(state.localAudio)addRecordingLocalAudio(state.localAudio);
  document.querySelectorAll('audio, #presentedMedia').forEach(connectRecordingMediaElement);
  rec.observer=new MutationObserver(()=>document.querySelectorAll('audio, #presentedMedia').forEach(connectRecordingMediaElement));
  rec.observer.observe(document.body,{childList:true,subtree:true});
  const mimeTypes=['video/webm;codecs=vp8,opus','video/webm;codecs=vp8','video/webm'];
  const mimeType=mimeTypes.find(type=>MediaRecorder.isTypeSupported(type))||'';
  const stream=new MediaStream([...canvasStream.getVideoTracks(),...audioDestination.stream.getAudioTracks()]);
  const recorder=new MediaRecorder(stream,mimeType?{mimeType,videoBitsPerSecond:1200000}: {videoBitsPerSecond:1200000});
  rec.recorder=recorder;
  let finish;
  rec.finished=new Promise(resolve=>finish=resolve);
  recorder.ondataavailable=event=>{
   if(event.data&&event.data.size){rec.chunks.push(event.data);const bytes=rec.chunks.reduce((sum,chunk)=>sum+chunk.size,0);if(bytes>45*1024*1024&&recorder.state==='recording'){roomStatus('Recording reached the 45 MB safety limit and is being saved.');recorder.stop();}}
  };
  recorder.onerror=event=>{console.warn('Recording error',event.error);roomStatus('The browser reported a recording error. The recording may be incomplete.');};
  recorder.onstop=async()=>{
   cancelAnimationFrame(rec.frame);rec.observer?.disconnect();rec.canvasStream.getTracks().forEach(track=>track.stop());
   rec.audioSources.forEach(source=>{try{source.disconnect();}catch{}});
   try{await rec.audioCtx.close();}catch{}
   const blob=new Blob(rec.chunks,{type:recorder.mimeType||'video/webm'});
   const duration=Math.max(1,Math.round((Date.now()-rec.startedAt)/1000));
   const path=state.classInfo.id+'/recordings/'+rec.id+'.webm';
   try{
    if(!blob.size||blob.size>50*1024*1024)throw new Error('Recording file is empty or exceeds the 50 MB storage limit.');
    const {error:uploadError}=await supabase.storage.from('class-materials').upload(path,blob,{contentType:'video/webm',upsert:false});
    if(uploadError)throw new Error(uploadError.message);
    const {error:updateError}=await supabase.from('class_recordings').update({status:'completed',storage_path:path,mime_type:'video/webm',file_size:blob.size,duration_seconds:duration,completed_at:new Date().toISOString(),error_message:null}).eq('id',rec.id);
    if(updateError)throw new Error(updateError.message);
    roomStatus('Recording saved to the school’s private class recordings.');
   }catch(error){
    await supabase.from('class_recordings').update({status:'failed',completed_at:new Date().toISOString(),error_message:String(error.message||error).slice(0,1000)}).eq('id',rec.id);
    roomStatus('Recording could not be saved: '+(error.message||'storage error'));
   }finally{
    if(state.recording===rec)state.recording=null;
    $('recordBtn').disabled=false;$('recordBtn').classList.remove('recording');$('recordBtn').textContent='⏺';
    $('recordBtn').setAttribute('aria-label','Start class recording');$('recordBtn').title='Start class recording';
    await loadRecordings();finish();
   }
  };
  const draw=()=>{
   if(state.recording!==rec)return;
   ctx.fillStyle='#101b19';ctx.fillRect(0,0,1280,720);
   const stage=$('presentationStage');
   const main=stage.querySelector('video')||stage.querySelector('.pdf-page')||stage.querySelector('canvas');
   if(main){try{ctx.drawImage(main,0,0,1280,610);}catch{}}
   else{ctx.fillStyle='#dbe8df';ctx.font='bold 34px sans-serif';ctx.fillText('Sprachenschule classroom',44,80);}
   const tiles=[...document.querySelectorAll('#videoGrid .video-tile')];
   const width=180,height=104,gap=16,total=tiles.length*(width+gap)-gap;
   let x=Math.max(24,(1280-total)/2);
   for(const tile of tiles){
    ctx.fillStyle='#263632';ctx.fillRect(x,625,width,height);
    const video=tile.querySelector('video');
    if(video&&video.readyState>=2){try{ctx.drawImage(video,x,625,width,height);}catch{}}
    ctx.fillStyle='#fff';ctx.font='16px sans-serif';ctx.fillText((tile.querySelector('.tile-name')?.textContent||'Participant').slice(0,22),x+6,713);
    x+=width+gap;if(x+width>1256)break;
   }
   ctx.fillStyle='#fff';ctx.font='bold 18px sans-serif';ctx.fillText('Sprachenschule · '+(state.classInfo.title||'Live lesson'),24,28);
   rec.frame=requestAnimationFrame(draw);
  };
  draw();recorder.start(5000);
  $('recordBtn').classList.add('recording');$('recordBtn').textContent='⏹';$('recordBtn').setAttribute('aria-label','Stop and save class recording');$('recordBtn').title='Stop and save class recording';
  roomStatus('Recording is active on this tutor device. Keep this browser open until it is saved.');
 }catch(error){
  if(recordingRowId)await supabase.from('class_recordings').update({status:'failed',completed_at:new Date().toISOString(),error_message:String(error.message||error).slice(0,1000)}).eq('id',recordingRowId);
  state.recording=null;$('recordBtn').disabled=false;
  roomStatus('Recording could not start: '+(error.message||'browser error'));
 }
}
async function stopRecording(){
 const rec=state.recording;if(!rec)return;
 roomStatus('Stopping recording and saving it to the school…');
 if(rec.recorder&&rec.recorder.state!=='inactive')rec.recorder.stop();
 if(rec.finished)await rec.finished;
}
async function loadRecordings(){
 if(!state.classInfo)return;
 const box=$('classRecordings');
 const {data,error}=await supabase.from('class_recordings').select('id,status,storage_path,mime_type,file_size,duration_seconds,created_at').eq('class_id',state.classInfo.id).order('created_at',{ascending:false}).limit(20);
 if(error){box.textContent='Recordings could not be loaded: '+error.message;return;}
 if(!data?.length){box.textContent='No class recordings yet.';return;}
 box.replaceChildren();
 for(const recording of data){
  const row=document.createElement('div');row.className='recording-row';
  const label=document.createElement('span');label.textContent=recording.status==='completed'?'Class recording · '+(recording.duration_seconds||0)+' sec':recording.status==='recording'?'Recording in progress':'Recording '+recording.status;
  row.append(label);
  if(recording.status==='completed'&&recording.storage_path){
   const {data:link,error:linkError}=await supabase.storage.from('class-materials').createSignedUrl(recording.storage_path,3600);
   if(!linkError&&link?.signedUrl){const a=document.createElement('a');a.href=link.signedUrl;a.download='sprachenschule-class-recording.webm';a.textContent='Download';row.append(a);}
  }
  box.append(row);
 }
}

async function leaveClass(redirect){
 if(state.leaving)return;state.leaving=true;
 if(state.recording)await stopRecording();
 clearInterval(state.heartbeatTimer);clearInterval(state.rosterTimer);
 try{await closeAttendance();if(state.classInfo)await supabase.rpc('classroom_leave',{p_class_id:state.classInfo.id,p_client_id:state.clientId});}catch{}
 if(state.channel)await supabase.removeChannel(state.channel);if(state.leaseChannel)await supabase.removeChannel(state.leaseChannel);
 for(const peer of state.peers.values())peer.pc.close();state.peers.clear();
 state.localAudio?.stop();state.localVideo?.stop();state.screenTrack?.stop();
 document.querySelectorAll('audio[id^="audio-"]').forEach(a=>a.remove());
 if(redirect){location.href=$('dashboardLink').href;return;}
 state.classInfo=null;state.leaving=false;$('roomArea').classList.add('hidden');$('joinCard').classList.remove('hidden');
}
$('joinForm').addEventListener('submit',joinClass);
$('micBtn').addEventListener('click',()=>setMic(!state.micOn));
$('camBtn').addEventListener('click',()=>setCamera(!state.camOn));
$('shareBtn').addEventListener('click',toggleShare);
$('leaveBtn').addEventListener('click',()=>leaveClass(true));
$('chatForm').addEventListener('submit',async e=>{e.preventDefault();const message=$('chatInput').value.trim();if(!message)return;addChat(state.profile.full_name||'You',message);$('chatInput').value='';await sendSignal('chat',{message});});
$('clapBtn').addEventListener('click',()=>{showClap(state.user.id);sendSignal('clap',{});});
$('raiseHandBtn').addEventListener('click',()=>{const raised=!state.hands.has(state.user.id);if(raised)state.hands.add(state.user.id);else state.hands.delete(state.user.id);renderHands();$('raiseHandBtn').setAttribute('aria-pressed',String(raised));sendSignal('hand',{raised});});
$('clearHandsBtn').addEventListener('click',()=>{state.hands.clear();renderHands();sendSignal('hand-clear',{});});
$('muteAllBtn').addEventListener('click',()=>{state.tutorMutedAll=!state.tutorMutedAll;$('muteAllBtn').textContent=state.tutorMutedAll?'🔊':'🔇';$('muteAllBtn').setAttribute('aria-label',state.tutorMutedAll?'Allow student microphones':'Mute all students');sendSignal('mute-all',{muted:state.tutorMutedAll});});
$('recordBtn').addEventListener('click',async()=>{if(state.recording)await stopRecording();else await startRecording();});
window.addEventListener('beforeunload',event=>{if(state.recording){event.preventDefault();event.returnValue='A class recording is still being saved.';}if(state.classInfo){navigator.sendBeacon?.(window.SUPABASE_URL+'/rest/v1/rpc/classroom_leave',new Blob([JSON.stringify({p_class_id:state.classInfo.id,p_client_id:state.clientId})],{type:'application/json'}));}});
initialize();
})();