const c=$('Validar turno y contexto').first().json.context;
const failure=$input.first().json;
const detail=[failure.error?.message,failure.error?.description,failure.message,typeof failure.error==='string'?failure.error:''].filter(v=>typeof v==='string').join(' ').toLowerCase();
const failureType=/pars|schema|format|json/.test(detail)?'structured_output':/rate|429|quota/.test(detail)?'rate_limit':/iteration/.test(detail)?'iteration_limit':/timeout|timed out|aborted/.test(detail)?'timeout':'agent_error';
return [{json:{http_status:503,response:{contract:'importados.bot.decision.v1',status:'agent_unavailable',turn_id:c.turn_id,conversation_id:c.conversation_id,send_allowed:false,requires_commit:false,mutations_executed:[],decision:null,retryable:true,evidence:{failure_type:failureType}}}}];
