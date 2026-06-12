export const AI_AGENT_COMPACT_DOCS = `YC_OS_AI_DOCS
auth=locked YC OS; operator unlock/handoff required; Bearer site token supplied outside prompt; never paste token/server secret.
start=GET /api/agent/capabilities truth source; call /api/mcp tools/list then tools/call, or POST /api/agent/tools/call.
read_tools=get_agent_guide,list_event_prep_events,get_event_prep_context,search_founders,list_approval_events,list_approval_queue,get_approval_summary,get_guest_context. Queue reads sanitized; guest context private.
write_tools=MCP only: create_event,add_event_attendees,enrich_event_context,add_event_guests,approve_applications,reject_applications,request_application_info. YC OS runtime executes records/provider effects.
rules=writes are live in production; omit execute or set execute=true; reason required; sendEmail=false; max 10 guests; never request .env/service-role/raw provider/shell/DB/GitHub/deploy.
report=page URL,event/filter,tool,live result,next decision.`;
