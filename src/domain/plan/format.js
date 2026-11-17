// The plan's JSON shape and the wording rules, as text for agents. Served on demand
// (codeflow_guide, validation prompts) instead of sitting in every tool description.

export const PLAN_FORMAT = `Plan format (ids optional on new items; keep existing ids):
Flow {id,title,entry:"path.py:line",change?,entrypoint?:true (called from outside the plan: HTTP route, CLI, job),spine:[Step|Gather|Try|Loop],refs?:[{title,subtitle?,rows:[[name,type,desc]]}],notes?:[{anchor:stepId,tone:note|check|fix|idea|question,text}]}
Step {kind:"step",module,num?,name,desc?,badges?:["await"|"loop"|"background"],status?,change?,link?:{tab:folder,flow?},inputs?:[[name,type,desc]],returns?,details?:[{side:"left"|"right",title,items:[Line]}]}
Gather = Step + {kind:"gather",mode:"gather"|"race"|"any",modeNote?,fanout?,tasks:[{k:"call"|"timer"|"ext",t,note?,link?}]}
Try {kind:"try",header,body:[spine items],except:{label,title?,items:[Line]}} · Loop {kind:"loop",header,acc?,body:[spine items]}
Line {k:"act"|"call"|"ext"|"raise"|"ret"|"jump",t,aw?:true,link?,status?,change?} · {k:"cond",t,yes:[Line],no:[Line]} · {k:"loop",t,acc?,body:[Line]} · {k:"try",body:[Line],except:"Exception",handler:[Line]}
status: proposed|approved|in_progress|done|failed. change: new (adds code) | edit (changes existing code) | remove (deletes it); set it on every planned item, on the most specific item (a new case inside an existing function = that Line is new, its step is edit). Vertical spine = sequence; details = drill-down panels.
Edit refs: the id of a flow, step, line, table or note; a panel is "<stepId>:left|right", a try handler "<stepId>:except".`

export const PLAIN_WORDS = `Write for non-technical readers, in plain English: step name = plain action starting with a verb ("Ask Claude for an answer"), code location in module; desc one sentence on why; lines one short sentence each: decisions as questions ("Is Claude set up?"), errors as "Stop: <reason>", results as "Send back <what>", loops as "For each <thing>", calls to other systems as "Ask <system> to <do something>"; no code expressions, argument lists, settings names, log text or jargon; reasons and caveats go in notes.`
