/*
 * LOCAL QA HARNESS — Control Check only.
 * Not a Prolific experiment. Requires http://localhost:8000/?exp=...&dev=1.
 * Does not change the published V20 participant experiment or scoring.
 */
import production from './two-hand-denovo-taught-rule-v20-FULL.js?v=qa-control-20261015';

const localHost = typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);
const dev = localHost && new URLSearchParams(window.location.search).get('dev') === '1';
if (!dev) throw new Error('CONTROL-TEST requires localhost with dev=1. It is not for participants or Prolific.');

const sourceTrials = typeof production.trials === 'function' ? production.trials() : production.trials;
const calibrationTrials = sourceTrials.filter(t => t.kind === 'continuous_calibration');
const gateTemplate = sourceTrials.find(t => t.id === 'v20_control_gate');
if (!gateTemplate || calibrationTrials.length !== 2) throw new Error('Could not locate V20 static calibration and Control Check.');

const QA_REPEATS = 60;  // Four movements per short QA round; no teaching or formal task.
const options = ['left','right','up','down'];
let selectedTarget = 'left';   // Start with the reported left-hand DOWN -> cursor LEFT bug.
let currentState = null;
let currentTrial = null;
let lastResultSignature = '';
let lastResult = null;
let panel = null;
let details = null;
let roundCounter = 0;

function q(n, digits = 3) { return Number.isFinite(n) ? Number(n).toFixed(digits) : '—'; }
function validGeometry(summary) {
  if (!summary?.calibrationComplete || !summary?.calibrationValid) return false;
  const c = summary;
  return [c.leftX,c.rightX,c.upY,c.downY].every(Number.isFinite) &&
    Number.isFinite(c.homeX) && Number.isFinite(c.homeY) &&
    [Math.abs(c.leftX-c.homeX),Math.abs(c.rightX-c.homeX),
     Math.abs(c.upY-c.homeY),Math.abs(c.downY-c.homeY)].every(d => d >= 0.05);
}
function freshQaGateState() {
  if (!currentTrial || !currentState) return;
  currentTrial.sequence = Array(4).fill(selectedTarget);
  const newState = production.onTrialStart(currentTrial, {});
  for (const key of Object.keys(currentState)) delete currentState[key];
  Object.assign(currentState, newState);
  lastResultSignature = '';
  console.info('[CONTROL-TEST] Reset current gate; calibration reused.', { target: selectedTarget });
}
function ensureHud() {
  if (!panel) {
    panel = document.createElement('aside');
    panel.id = 'v20-local-gate-qa';
    panel.style.cssText = [
      'position:fixed','bottom:12px','left:12px','width:min(460px,calc(100vw - 24px))',
      'z-index:2147483000','background:rgba(3,9,19,.94)','color:#f5f8ff',
      'font:13px/1.4 ui-monospace,Consolas,monospace',
      'border:1px solid #63c4cf','border-radius:9px','padding:12px',
      'box-shadow:0 8px 22px rgba(0,0,0,.35)','pointer-events:auto'
    ].join(';');
    const header = document.createElement('div');
    header.textContent = 'LOCAL CONTROL CHECK TEST  ·  no upload';
    header.style.cssText = 'font-weight:800;color:#9ce8db;margin-bottom:7px';
    panel.appendChild(header);
    const buttons = document.createElement('div');
    buttons.style.cssText='display:flex;flex-wrap:wrap;gap:5px;margin-bottom:9px';
    for (const [key,label] of [['left','LEFT ◀ (left hand DOWN)'],['right','RIGHT ▶'],['up','UP ▲'],['down','DOWN ▼']]) {
      const btn=document.createElement('button');
      btn.textContent=label;
      btn.type='button';btn.dataset.qaDirection=key;
      btn.style.cssText='cursor:pointer;background:#224b73;color:#fff;border:1px solid #8babbf;border-radius:5px;padding:5px 7px;font-size:11px';
      btn.addEventListener('click',()=>{selectedTarget=key;freshQaGateState();updateButtonState();});
      buttons.appendChild(btn);
    }
    const reset=document.createElement('button');
    reset.type='button'; reset.textContent='RESET CHECK (R)';
    reset.style.cssText='cursor:pointer;background:#74522c;color:#fff;border:1px solid #b4a183;border-radius:5px;padding:5px 7px;font-size:11px';
    reset.addEventListener('click',freshQaGateState);
    buttons.appendChild(reset);
    panel.appendChild(buttons);
    details=document.createElement('div');details.style.whiteSpace='pre-wrap';panel.appendChild(details);
    const note=document.createElement('div');note.textContent='HOME: both hands must hold still first. REACH: left hand DOWN should make cursor X negative (LEFT).';
    note.style.cssText='color:#9cc2e0;margin-top:7px;font:12px/1.3 system-ui,sans-serif';
    panel.appendChild(note);
  }
  if (!panel.isConnected) document.body.appendChild(panel);
  updateButtonState();
}
function updateButtonState() {
  if (!panel) return;
  for (const btn of panel.querySelectorAll('[data-qa-direction]')) {
    const selected=btn.dataset.qaDirection===selectedTarget;
    btn.style.borderColor=selected?'#e9cb74':'#8babbf';
    btn.style.background=selected?'#6d5229':'#224b73';
  }
}
let lastHudAt = -Infinity;
function updateHud(state, derived, tMs) {
  if (!details || !state) return;
  if(tMs-lastHudAt<110) return;
  lastHudAt=tMs;
  const found = Array.isArray(derived?.h) ? derived.h : [];
  const ldy = Number.isFinite(derived?.leftY) && state.origin?.Left ? derived.leftY-state.origin.Left.y : null;
  const rightDx=Number.isFinite(derived?.rightX)&&state.origin?.Right?derived.rightX-state.origin.Right.x:null;
  const taskx=state.currentTask?.x;
  const checkMapping=Number.isFinite(ldy)?-ldy:null;
  const remaining=state.phase==='reach' && Number.isFinite(state.targetAt)?(15_000-(state.clock-state.targetAt))/1000:null;
  const cause = state.phase==='home' ? 'Cursor inactive: hold BOTH hands at HOME first' :
    !found.includes('Left') || !found.includes('Right') ? 'Tracking missing: BOTH hands required' :
    state.phase==='reach' && Math.abs(checkMapping||0)<.02 ? 'Left vertical input near zero' : 'Move left hand DOWN -> cursor should go LEFT';
  const result=lastResult?.outcome ? `${lastResult.outcome} / IDE ${q(lastResult.initialDirectionalErrorDeg,1)}°`:'none yet';
  details.textContent = [
    `Round ${roundCounter}    target=${selectedTarget.toUpperCase()}   phase=${String(state.phase).toUpperCase()}`,
    `TRACK: left ${found.includes('Left')?'YES':'NO'} | right ${found.includes('Right')?'YES':'NO'}`,
    `Normalized LEFT y=${q(derived?.leftY)}  ΔLeft y=${q(ldy)}`,
    `Expected cursor X=-ΔLeft y=${q(checkMapping)} | state cursor X=${q(taskx)}`,
    `RIGHT Δx=${q(rightDx)} | target time left=${q(remaining,1)}s`,
    `Score errors=${state.errors} attempts=${state.index} technicalInvalid=${state.gateTechnicalInvalidTotal}`,
    `Last result: ${result}`,
    `DIAGNOSIS: ${cause}`
  ].join('\n');
}

document.addEventListener('keydown',e=>{
  if(!currentTrial || e.altKey || e.ctrlKey || e.metaKey || /INPUT|TEXTAREA/.test(e.target?.tagName||'')) return;
  const targets={'1':'left','2':'right','3':'up','4':'down'};
  if(targets[e.key]) {selectedTarget=targets[e.key];freshQaGateState();updateButtonState();}
  if(e.key.toLowerCase()==='r'&&!e.repeat) freshQaGateState();
});

const qaGates=Array.from({length:QA_REPEATS},(_,i)=>({
  ...gateTemplate, id:`v20_qa_control_${String(i+1).padStart(2,'0')}`,
  qaControlGate:true, sequence:Array(4).fill('left'),
  skipRestAfter:true, durationSec:240
}));
const trials = [
  ...calibrationTrials.map(trial=>({...trial,skipRestAfter:true})),
  ...qaGates
];

const experiment={
  ...production,
  id:'two-hand-denovo-taught-rule-v20-CONTROL-TEST',
  title:'LOCAL QA: V20 Control Check only (no study submission)',
  trials,
  participantFlow:{...production.participantFlow,postTaskSurvey:false},
  qualityControl:{
    ...production.qualityControl,
    evaluateTrial(context){
      if(context.trial.qaControlGate) {
        console.info('[CONTROL-TEST] Completed 4-target test round:',{
          reaches:context.summary?.reaches,
          failures:context.summary?.gateErrorCount,
          tracking:context.summary?.gateTechnicalInvalidTotal
        });
        return {action:'continue'};  // Never return to Prolific for a failed QA round.
      }
      if(context.trial.kind==='continuous_calibration' && validGeometry(context.summary)) {
        console.info('[CONTROL-TEST] Calibration geometry valid; allowing diagnostic gate test.',context.summary);
        return {action:'continue'};
      }
      return production.qualityControl.evaluateTrial(context);
    }
  },
  onTrialStart(trial,context){
    if(trial.qaControlGate) {
      trial.sequence=Array(4).fill(selectedTarget);
      roundCounter++;
      lastResultSignature='';
    }
    const state=production.onTrialStart(trial,context);
    if(trial.qaControlGate) {
      currentTrial=trial;currentState=state;
      ensureHud();
    } else {
      currentTrial=null;currentState=null;
      if(panel?.isConnected)panel.remove();
    }
    return state;
  },
  onFrame(args){
    const derived=production.onFrame(args);
    if(args.trial.qaControlGate) {
      const state=args.state;
      if(state.lastResult && state.lastResult !== lastResult) {
        lastResult=state.lastResult;
        console.info('[CONTROL-TEST] Score:',lastResult);
      }
      // Finish a short four-attempt QA block and advance to the next one.
      // Normal production pass/fail/timeout logic is untouched.
      if(state.index>=4 && state.phase==='feedback' && state.clock-state.feedbackAt>=430){
        state.finished=true;
        state.failureReason=null;
      }
      if(state.failureReason){
        // QA only: a genuine gate failure must not send the researcher to Prolific.
        console.warn('[CONTROL-TEST] Gate check ended:',state.failureReason);
        state.finished=true;
        state.failureReason=null;
      }
      updateHud(state,derived,args.tMs);
    }
    return derived;
  },
  draw(ctx,args){
    if(args.trial.qaControlGate)ensureHud();
    return production.draw(ctx,args);
  },
  onTrialEnd(args){
    const summary=production.onTrialEnd(args);
    if(args.trial.qaControlGate) {
      console.info('[CONTROL-TEST] Round finished; next round starts without repeating calibration.',summary);
    }
    return summary;
  }
};
export default experiment;
