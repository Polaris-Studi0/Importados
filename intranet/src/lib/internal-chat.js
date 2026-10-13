import {supabase,isDemoMode} from './supabase.js';
export async function chatOverview(){if(isDemoMode)return [];const {data,error}=await supabase.rpc('internal_chat_overview');if(error)throw error;return data.sort((a,b)=>a.branch_id.localeCompare(b.branch_id,'es',{numeric:true}));}
export async function chatMessages(branch,before=null){
 if(isDemoMode)return [];let q=supabase.from('internal_chat_messages').select('*').eq('branch_id',branch).order('id',{ascending:false}).limit(50);if(before)q=q.lt('id',before);const {data,error}=await q;if(error)throw error;return data.reverse();
}
export async function sendChatMessage(branch,body,requestId){const {data,error}=await supabase.rpc('send_internal_chat',{p_branch:branch,p_body:body,p_request:requestId});if(error)throw error;return data;}
export async function markChatRead(branch,through){const {error}=await supabase.rpc('mark_internal_chat_read',{p_branch:branch,p_through:through});if(error)throw error;}
export function watchChat(profile,onChange){
 if(isDemoMode)return()=>{};
 const filter=profile.role==='admin'?{}:{filter:`branch_id=eq.${profile.branch_id}`};
 const channel=supabase.channel('branch-chat-'+profile.id)
 .on('postgres_changes',{event:'INSERT',schema:'public',table:'internal_chat_messages',...filter},payload=>onChange(payload.new))
 .on('postgres_changes',{event:'*',schema:'public',table:'internal_chat_reads',filter:`user_id=eq.${profile.id}`},()=>onChange())
 .subscribe();return()=>supabase.removeChannel(channel);
}
export function mergeChatMessages(...groups){return [...new Map(groups.flat().map(m=>[m.id,m])).values()].sort((a,b)=>a.id-b.id);}
