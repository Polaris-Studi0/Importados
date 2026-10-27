import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {matchesFile,receiveIncomingMedia,trustedMediaUrl,viewIncomingMedia} from '../src/whatsapp-incoming-media.js';

const origin='https://opeytkcqblgjfyvfjkwe.supabase.co';
const env={SUPABASE_URL:origin,SUPABASE_SERVICE_KEY:'synthetic-service',WHATSAPP_ACCESS_TOKEN:'synthetic-meta',WHATSAPP_GRAPH_VERSION:'v25.0'};
const messageId=randomUUID(),conversationId=randomUUID(),lease=randomUUID();
const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
const sha=createHash('sha256').update(png).digest('hex');
const claim={message_id:messageId,conversation_id:conversationId,meta_media_id:'123456789123456',phone_number_id:'234567891234567',kind:'image',lease_token:lease};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
async function mocked(handler,work){const fetchBefore=globalThis.fetch;globalThis.fetch=(url,options={})=>Promise.resolve(handler(new URL(url),options));try{return await work();}finally{globalThis.fetch=fetchBefore;}}

test('provider files use bounded private storage and verify the exact Meta hash',async()=>{
 let stored=false,finished;
 await mocked((u,o)=>{
  if(u.pathname==='/rest/v1/rpc/whatsapp_claim_incoming_media')return json(claim);
  if(u.hostname==='graph.facebook.com'){assert.equal(o.redirect,'manual');assert.equal(u.searchParams.get('phone_number_id'),claim.phone_number_id);return json({id:claim.meta_media_id,url:'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=synthetic',mime_type:'image/png',file_size:png.length,sha256:sha});}
  if(u.hostname==='lookaside.fbsbx.com'){assert.equal(o.redirect,'manual');assert.equal(o.headers.Authorization,'Bearer synthetic-meta');return new Response(png);}
  if(u.pathname.startsWith('/storage/v1/object/')){assert.equal(u.pathname,`/storage/v1/object/whatsapp-incoming-media/${conversationId}/${messageId}`);assert.equal(o.headers['x-upsert'],'false');stored=true;return json({});}
  if(u.pathname==='/rest/v1/rpc/whatsapp_finish_incoming_media'){finished=JSON.parse(o.body);return json(true);}
  assert.fail(u.href);
 },async()=>assert.equal((await receiveIncomingMedia(env,messageId)).stored,true));
 assert.equal(stored,true);assert.equal(finished.p_status,'stored');assert.equal(finished.p_data.sha256,sha);
});

test('a provider URL cannot send the Meta credential outside its CDN, and invalid bytes are rejected',async()=>{
 for(const url of ['http://lookaside.fbsbx.com/file','https://lookaside.fbsbx.com.evil.test/file','https://127.0.0.1/file','https://user@lookaside.fbsbx.com/file','https://lookaside.fbsbx.com:444/file'])assert.equal(trustedMediaUrl(url),false);
 assert.equal(matchesFile(png,'image/png'),true);assert.equal(matchesFile(png,'application/pdf'),false);
 let finished;
 await mocked((u,o)=>{
  if(u.pathname.endsWith('whatsapp_claim_incoming_media'))return json(claim);
  if(u.hostname==='graph.facebook.com')return json({id:claim.meta_media_id,url:'https://evil.test/secret',mime_type:'image/png',file_size:png.length,sha256:sha});
  if(u.pathname.endsWith('whatsapp_finish_incoming_media')){finished=JSON.parse(o.body);return json(true);}
  assert.fail('Credential or object escaped: '+u.href);
 },async()=>assert.equal((await receiveIncomingMedia(env,messageId)).stored,false));
 assert.equal(finished.p_status,'unsupported');
});

test('an attachment belongs to its exact conversation and requires current consent before provider access',async()=>{
 await mocked(u=>{if(u.pathname==='/rest/v1/whatsapp_messages'){assert.equal(u.searchParams.get('conversation_id'),'eq.'+conversationId);return json([]);}assert.fail(u.href);},async()=>await assert.rejects(viewIncomingMedia(env,{id:conversationId},messageId),/no encontrado en esta/));
 await mocked(u=>u.pathname==='/rest/v1/whatsapp_messages'?json([{id:messageId,attachment:{id:claim.meta_media_id}}]):u.pathname==='/rest/v1/whatsapp_config'?json([{privacy_version:'synthetic-v1'}]):assert.fail(u.href),async()=>await assert.rejects(viewIncomingMedia(env,{id:conversationId,consent_status:'revoked'},messageId),/autorizar/));
});
