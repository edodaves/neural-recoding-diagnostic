'use strict';
/*
 * Neural Recoding diagnostic engine.
 *
 * AI mode    Runs when ANTHROPIC_API_KEY is set. Reads what the person shared,
 *            picks every next question from the bank based on all answers so far,
 *            and writes the result, Edo's call brief and the dashboard seed.
 * Rules mode Runs when there is no key, or whenever an AI call fails, so the
 *            diagnostic never breaks. Fixed path through the bank.
 *
 * The four pattern percentages are always computed here from the answers,
 * never invented by the model, so every result can be traced back.
 *
 * Optional env vars:
 *   DIAG_MODEL_FAST  picks questions          (default claude-haiku-5-5)
 *   DIAG_MODEL_DEEP  reads and writes results (default claude-sonnet-5-5)
 */

const BANK = require('./bank');

const PATTERNS = ['approval', 'perfectionism', 'scarcity', 'identity'];
const STAGES = ['pre', 'early', 'growing', 'plateau', 'declining', 'scaling'];
const AREAS = ['situation', 'acquisition', 'sales', 'pricing', 'offer', 'delivery', 'team', 'money', 'unit_economics',
  'market', 'focus', 'time', 'visibility', 'launch', 'growth', 'decisions', 'self', 'other'];
const MISSING = ['current_situation', 'goal', 'stated_problem', 'numbers'];
const FITS = ['full_recode', 'sprint', 'collective', 'not_yet', 'unclear'];

const MIN_Q = 6;        // AI mode: never stop before this many answers
const MAX_Q = 12;       // AI mode: never ask more than this
const MAX_TEXT = 3;     // open-text questions per session (bank + clarify)
const MAX_CLARIFY = 2;  // AI-written follow-up questions per session
const RULES_LEN = 8;    // rules mode: questions after the stage question
const PRIOR = 0.3;      // keeps percentages honest when evidence is thin
const NEUTRAL = "Doesn't apply to me";
const LIMIT = { context: 6000, answer: 1500, history: 16, facts: 20, fact: 200, field: 400 };

const MODEL_FAST = process.env.DIAG_MODEL_FAST || 'claude-haiku-5-5';
const MODEL_DEEP = process.env.DIAG_MODEL_DEEP || 'claude-sonnet-5-5';
const ABBR = { approval: 'ap', perfectionism: 'pe', scarcity: 'sc', identity: 'id' };

const BY_ID = Object.create(null);
BANK.forEach(q => { BY_ID[q.id] = q; });

// ---------- helpers ----------
const zero = () => ({ approval: 0, perfectionism: 0, scarcity: 0, identity: 0 });
const clip = (s, n) => { s = s == null ? '' : String(s); return s.length > n ? s.slice(0, n) : s; };
const tidy = (s, n) => clip(String(s == null ? '' : s).replace(/\s*—\s*/g, ', ').replace(/[ \t]+/g, ' ').trim(), n || LIMIT.field);
const lower = s => String(s == null ? '' : s).trim().toLowerCase();
const hasKey = () => !!process.env.ANTHROPIC_API_KEY;
const fitsStage = (q, stage) => !stage || q.stages.indexOf(stage) !== -1;
const weighted = o => Object.keys(o.w).length > 0;

function targetsOf(q) {
  const t = new Set();
  if (q.format === 'scale') Object.keys(q.w).forEach(p => t.add(p));
  if (q.opts) q.opts.forEach(o => Object.keys(o.w).forEach(p => t.add(p)));
  return PATTERNS.filter(p => t.has(p));
}
function autoNeutral(q) {
  return (q.format === 'single' || q.format === 'multi') && q.opts.every(weighted);
}

// What the browser receives. Weights never leave the server.
function toClient(q, wording) {
  const out = { id: q.id, kind: 'bank', format: q.format, text: wording || q.q };
  if (q.format === 'scale') { out.statement = q.s; out.neutral = NEUTRAL; }
  if (q.format === 'single' || q.format === 'multi') {
    out.opts = q.opts.map(o => ({ t: o.t, x: q.format === 'multi' && !weighted(o) }));
    out.neutral = autoNeutral(q) ? NEUTRAL : null;
    out.allowOpen = q.depth >= 2;
  }
  return out;
}
function clarifyQuestion(n, text) {
  return { id: 'C' + n, kind: 'clarify', format: 'text', text };
}

// ---------- input cleaning (the browser sends the whole session each call) ----------
function sanitizeEvidence(list) {
  return (Array.isArray(list) ? list : []).slice(0, 8).map(e => {
    const p = lower(e && e.pattern);
    return {
      pattern: PATTERNS.indexOf(p) !== -1 ? p : null,
      strength: Math.max(1, Math.min(3, Math.round(Number(e && e.strength) || 1))),
      quote: tidy(e && e.quote, 200)
    };
  }).filter(e => e.pattern);
}

function sanitizeProfile(p) {
  p = p && typeof p === 'object' ? p : {};
  const stated = Array.isArray(p.stated) ? p.stated : (Array.isArray(p.stated_limiters) ? p.stated_limiters : []);
  const stage = lower(p.stage);
  return {
    stage: STAGES.indexOf(stage) !== -1 ? stage : null,
    business: tidy(p.business, 300),
    current: tidy(p.current, 300),
    goal: tidy(p.goal, 300),
    trajectory: tidy(p.trajectory, 20),
    stated: stated.slice(0, 5).map(s => ({
      label: tidy(s && s.label, 160),
      kind: lower(s && s.kind) === 'psychological' ? 'psychological' : 'business',
      area: AREAS.indexOf(lower(s && s.area)) !== -1 ? lower(s.area) : 'other'
    })).filter(s => s.label),
    missing: (Array.isArray(p.missing) ? p.missing : []).map(lower).filter(m => MISSING.indexOf(m) !== -1).slice(0, 4),
    language: tidy(p.language, 30)
  };
}

function sanitizeEntry(h) {
  if (!h || typeof h !== 'object' || !h.q || typeof h.q !== 'object') return null;
  const kind = h.q.kind === 'clarify' ? 'clarify' : 'bank';
  const id = clip(h.q.id, 12);
  if (kind === 'bank' && !BY_ID[id]) return null;
  const a = h.answer && typeof h.answer === 'object' ? h.answer : {};
  return {
    q: { id, kind, format: kind === 'clarify' ? 'text' : BY_ID[id].format, text: tidy(h.q.text, 300) },
    answer: {
      picks: Array.isArray(a.picks) ? a.picks.filter(i => Number.isInteger(i) && i >= 0 && i < 12).slice(0, 8) : [],
      na: !!a.na,
      value: Number.isInteger(a.value) && a.value >= 1 && a.value <= 5 ? a.value : null,
      text: clip(String(a.text || '').trim(), LIMIT.answer),
      skipped: !!a.skipped
    },
    evidence: sanitizeEvidence(h.evidence)
  };
}

function sanitizeState(raw) {
  raw = raw && typeof raw === 'object' ? raw : {};
  return {
    context: clip(String(raw.context || '').trim(), LIMIT.context),
    heard: tidy(raw.heard, LIMIT.field),
    profile: sanitizeProfile(raw.profile),
    contextEvidence: sanitizeEvidence(raw.contextEvidence),
    facts: (Array.isArray(raw.facts) ? raw.facts : []).slice(0, LIMIT.facts).map(f => tidy(f, LIMIT.fact)).filter(Boolean),
    history: (Array.isArray(raw.history) ? raw.history : []).slice(0, LIMIT.history).map(sanitizeEntry).filter(Boolean)
  };
}

function stageOf(state) {
  if (state.profile.stage) return state.profile.stage;
  const h = state.history.find(x => x.q.id === 'S00');
  if (h && h.answer.picks.length) return BY_ID.S00.stageMap[h.answer.picks[0]] || null;
  return null;
}

// ---------- scoring ----------
function entryScores(h) {
  const out = zero();
  if (h.q.kind === 'bank') {
    const b = BY_ID[h.q.id];
    const a = h.answer;
    const qw = b.qw || 1;
    if ((b.format === 'single' || b.format === 'multi') && !a.na) {
      let picks = a.picks.filter(i => i < b.opts.length);
      if (b.format === 'single') picks = picks.slice(0, 1);
      const scoring = picks.filter(i => weighted(b.opts[i]));
      scoring.forEach(i => {
        const ow = b.opts[i].w;
        for (const p in ow) out[p] += (qw / scoring.length) * ow[p];
      });
    } else if (b.format === 'scale' && !a.na && a.value) {
      const f = (a.value - 1) / 4;
      for (const p in b.w) out[p] += qw * f * b.w[p];
    }
  }
  // free text in this answer, as read by the AI
  const ai = zero();
  h.evidence.forEach(e => { ai[e.pattern] += e.strength / 3; });
  PATTERNS.forEach(p => { out[p] += Math.min(1, ai[p]); });
  return out;
}

function contextScores(state) {
  const out = zero();
  state.contextEvidence.forEach(e => { out[e.pattern] += e.strength / 3; });
  PATTERNS.forEach(p => { out[p] = Math.min(1.5, out[p]); });
  return out;
}

function toPercent(vals) {
  const sum = PATTERNS.reduce((s, p) => s + vals[p], 0) || 1;
  const rows = PATTERNS.map(p => {
    const v = vals[p] * 100 / sum;
    return { p, f: Math.floor(v), r: v - Math.floor(v) };
  });
  let left = 100 - rows.reduce((s, r) => s + r.f, 0);
  rows.slice().sort((a, b) => b.r - a.r).forEach(r => { if (left > 0) { r.f += 1; left -= 1; } });
  const out = {};
  rows.forEach(r => { out[r.p] = r.f; });
  return out;
}

function patternMap(state) {
  const raw = contextScores(state);
  const recency = zero();
  state.history.forEach((h, i) => {
    const s = entryScores(h);
    PATTERNS.forEach(p => { raw[p] += s[p]; if (s[p] > 0) recency[p] = i + 1; });
  });
  const smoothed = {};
  PATTERNS.forEach(p => { smoothed[p] = raw[p] + PRIOR; });
  const percentages = toPercent(smoothed);
  // ties go to whichever pattern showed up most recently
  const order = PATTERNS.slice().sort((a, b) => (smoothed[b] - smoothed[a]) || (recency[b] - recency[a]));
  const total = PATTERNS.reduce((s, p) => s + raw[p], 0);
  let confidence = total < 2.5 ? 'low' : total < 5 ? 'medium' : 'high';
  if (confidence === 'high' && percentages[order[0]] - percentages[order[1]] < 8) confidence = 'medium';
  return { percentages, primary: order[0], secondary: order[1], order, confidence, evidence: Math.round(total * 100) / 100 };
}

// ---------- readable answers (for prompts and the lead sheet) ----------
function questionLabel(h) {
  if (h.q.kind === 'clarify') return h.q.text;
  const b = BY_ID[h.q.id];
  if (b.format === 'scale') return 'How true: "' + b.s + '"';
  return h.q.text || b.q;
}
function answerLabel(h) {
  const a = h.answer;
  if (h.q.format === 'text') return a.skipped || !a.text ? '(skipped)' : '"' + a.text + '"';
  const b = BY_ID[h.q.id];
  let s;
  if (b.format === 'scale') s = a.na ? NEUTRAL : (a.value ? a.value + ' out of 5' : '(no answer)');
  else s = a.na ? NEUTRAL : (a.picks.filter(i => b.opts[i]).map(i => b.opts[i].t).join(' + ') || '(no answer)');
  if (a.text) s += ' | also wrote: "' + a.text + '"';
  return s;
}
function dominant(scores) {
  let best = null, v = 0;
  PATTERNS.forEach(p => { if (scores[p] > v) { v = scores[p]; best = p; } });
  return best;
}
function answerList(state) {
  return state.history.map(h => ({
    q: questionLabel(h),
    chosen: answerLabel(h),
    archetype: dominant(entryScores(h)) || (h.q.format === 'text' ? 'open' : 'none')
  }));
}

// ---------- rules mode: fixed path ----------
const PAIR_Q = {
  'approval|scarcity': 'DIS01', 'approval|perfectionism': 'DIS02', 'identity|scarcity': 'DIS03',
  'identity|perfectionism': 'DIS04', 'approval|identity': 'DIS05', 'perfectionism|scarcity': 'DIS06'
};
const TEST_Q = { approval: 'DIS07', scarcity: 'DIS08', perfectionism: 'DIS09', identity: 'DIS10' };
const STAGE_Q = {
  pre: ['PRE03', 'MON05'], early: ['SAL01', 'PRI02'], growing: ['TEAM01', 'NXT01'],
  plateau: ['PRI02', 'NXT01'], declining: ['DEC01', 'SCA01'], scaling: ['NXT01', 'TEAM01']
};

function rulesPick(state) {
  const stage = stageOf(state);
  const asked = new Set(state.history.map(h => h.q.id));
  if (!stage) return asked.has('S00') ? null : BY_ID.S00;
  const answered = state.history.filter(h => h.q.id !== 'S00').length;
  if (answered >= RULES_LEN || state.history.length >= MAX_Q) return null;

  const ok = q => q && !asked.has(q.id) && q.id !== 'S00' && q.format !== 'text' && !q.aiOnly && !q.needsTeam && fitsStage(q, stage);
  const first = ids => ids.map(id => BY_ID[id]).find(ok) || null;
  const order = patternMap(state).order;
  const statements = BANK.filter(q => q.format === 'scale');
  const belief = p => statements.find(q => ok(q) && Object.keys(q.w).length === 1 && q.w[p]) ||
    statements.find(q => ok(q) && q.w[p] && q.w[p] === Math.max.apply(null, Object.keys(q.w).map(k => q.w[k]))) || null;
  const separate = (a, b) => first([PAIR_Q[[a, b].sort().join('|')], TEST_Q[a], TEST_Q[b]]);

  const plan = [
    () => first(stage === 'pre' ? ['PRE01', 'OFF03'] : ['FOC01', 'ACQ01']),
    () => first(['VIS01', 'VIS07']),
    () => first(STAGE_Q[stage]),
    () => belief(order[0]),
    () => belief(order[1]),
    () => belief(order[3]),                      // blind-spot check on the weakest pattern
    () => separate(order[0], order[1]),
    () => first(stage === 'pre' ? ['DIS14', 'DIS11'] : ['DIS13', 'DIS11', 'DIS12'])
  ];
  const step = plan[answered];
  return (step && step()) || BANK.find(x => ok(x) && x.depth >= 2) || null;
}

// ---------- AI mode ----------
const S = { type: 'string' };
const STR_ARR = { type: 'array', items: { type: 'string' } };
const EVIDENCE = {
  type: 'array',
  items: {
    type: 'object', additionalProperties: false, required: ['pattern', 'strength', 'quote'],
    properties: { pattern: { type: 'string', enum: PATTERNS }, strength: { type: 'integer' }, quote: S }
  }
};
const NEXT_Q = {
  type: 'object', additionalProperties: false, required: ['type', 'id', 'text', 'why'],
  properties: { type: { type: 'string', enum: ['bank', 'clarify'] }, id: S, text: S, why: S }
};
const START_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['profile', 'heard', 'evidence', 'safety_flag', 'next'],
  properties: {
    profile: {
      type: 'object', additionalProperties: false,
      required: ['stage', 'business', 'current', 'goal', 'trajectory', 'stated_limiters', 'missing', 'language'],
      properties: {
        stage: { type: 'string', enum: STAGES },
        business: S, current: S, goal: S,
        trajectory: { type: 'string', enum: ['not_started', 'going_well', 'stuck', 'going_backwards', 'unclear'] },
        stated_limiters: {
          type: 'array',
          items: {
            type: 'object', additionalProperties: false, required: ['label', 'kind', 'area'],
            properties: { label: S, kind: { type: 'string', enum: ['business', 'psychological'] }, area: { type: 'string', enum: AREAS } }
          }
        },
        missing: { type: 'array', items: { type: 'string', enum: MISSING } },
        language: S
      }
    },
    heard: S, evidence: EVIDENCE, safety_flag: { type: 'boolean' }, next: NEXT_Q
  }
};
const NEXT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['answer_evidence', 'facts', 'safety_flag', 'decision', 'next'],
  properties: {
    answer_evidence: EVIDENCE, facts: STR_ARR, safety_flag: { type: 'boolean' },
    decision: { type: 'string', enum: ['ask', 'stop'] }, next: NEXT_Q
  }
};
const FINISH_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['result', 'brief', 'seed'],
  properties: {
    result: {
      type: 'object', additionalProperties: false, required: ['headline', 'said', 'pointing', 'cost', 'shift', 'pattern_lines'],
      properties: {
        headline: S, said: S, pointing: S, cost: S, shift: S,
        pattern_lines: {
          type: 'object', additionalProperties: false, required: PATTERNS,
          properties: { approval: S, perfectionism: S, scarcity: S, identity: S }
        }
      }
    },
    brief: {
      type: 'object', additionalProperties: false,
      required: ['summary', 'stage', 'numbers', 'goal', 'stated_problem', 'likely_problem', 'key_quotes', 'blind_spots', 'call_opener', 'fit', 'fit_reason', 'flags'],
      properties: {
        summary: S, stage: S, numbers: S, goal: S, stated_problem: S, likely_problem: S,
        key_quotes: STR_ARR, blind_spots: STR_ARR, call_opener: S,
        fit: { type: 'string', enum: FITS }, fit_reason: S, flags: STR_ARR
      }
    },
    seed: {
      type: 'object', additionalProperties: false, required: ['baseline', 'goal', 'beliefs', 'behaviors_to_track', 'first_focus'],
      properties: { baseline: S, goal: S, beliefs: STR_ARR, behaviors_to_track: STR_ARR, first_focus: S }
    }
  }
};

const INSTRUCTIONS = `You run the adaptive diagnostic for Edo Daves' Neural Recoding: 1:1 coaching for entrepreneurs, grounded in neuroscience, CBT and memory reconsolidation.

THE PREMISE
Most business ceilings are held in place by an old, learned belief that once protected the person and now limits them. The problem they name (no leads, thin margins, can't scale) is often downstream of that belief. Your job is to trace each person from what they say is wrong down to the belief and pattern underneath, in as few questions as possible.
The ladder: situation > stated problem > what they do about it (behavior) > what they believe (belief) > pattern.
You stop at belief and pattern. Origins, childhood and the deep work happen with Edo on the call, never here.

THE FOUR PATTERNS
approval: being visible got tied to being judged. Hides work, underclaims, avoids posting or asking for the sale, prices to be liked, can't say no, delays launches, cares what peers or family think.
perfectionism: "not ready yet" never resolves. Endless revising, rebuilding the offer, more courses before starting, over-preparing, can't delegate because nobody does it right, calmer revising than shipping.
scarcity: old survival math about not having enough clients, money or time. Takes wrong clients, discounts, won't raise prices even when full, panics in slow weeks, can't invest or hire, overworks, grabs every opportunity.
identity: self-image lags behind the goal. Knows the move and doesn't make it, success feels unreal, slips back after breakthroughs, explains wins away, feels like pretending, next-level founders feel like a different kind of person.

STAGES
pre: not launched yet. early: first clients. growing: working, wants it faster. plateau: stuck at a level. declining: going backwards. scaling: established, going for the next level.

HOW TO PICK THE NEXT QUESTION
1. Fit the person. Only ask what makes sense for their stage and what they told you. Never assume a problem they didn't mention. If things are going well, the "problem" is the gap between where they are and where they want to be.
2. If something essential is missing (where they are now, where they want to be, or what they think is in the way), get it first.
3. Test what they say the problem is before going into psychology: one or two questions that check whether it's really the bottleneck and what they've done about it.
4. Then go down the ladder: behavior questions, then belief statements (scale format). Belief statements surface what people can't put into words, so use at least two.
5. Check at least one pattern they haven't shown yet, as a blind-spot check.
6. When the top two patterns are close, use a question that separates them (depth 4).
7. Mix business and psychology. Never more than two fact questions in a row. Don't repeat ground already covered, including what they said at the start.
8. Questions marked "only if relevant" assume a specific problem. Use them only if the person named that problem.
9. Stop when at least 6 questions are answered, their stated problem has been tested, and one pattern clearly leads (or the top two have been separated). Never go past 12.

WORDING
You may reword a bank question to use their words or business ("your agency" instead of "your business"), as long as the meaning stays the same and the answer options still fit. Keep it under 20 words. Never reword scale statements. To keep the bank wording, return an empty text.
A clarify question is one short open question (under 20 words) for when an answer was vague or something essential is missing. Use it sparingly.
Voice: Edo's. Short sentences. Plain words. Direct and warm. No jargon, no hype, no em dashes, no therapy language, no diagnoses.

NEVER ask about childhood, trauma, health, medication, sex, religion, politics or family conflict. These are patterns, not conditions. Don't diagnose anything.

SAFETY
Set safety_flag to true only if the person explicitly mentions suicidal thoughts, self-harm, being in danger, or abuse. Business stress and figures of speech ("this is killing me") are not flags.

EVIDENCE
When you judge free text, only count clear signals in their own words. strength 1 = a hint, 2 = clear, 3 = strong and explicit. Quote their words, under 15 words.`;

let SYSTEM = null;
function systemPrompt() {
  if (SYSTEM) return SYSTEM;
  const stagesLabel = s => s.length === 6 ? 'all' : (s.length === 5 && s.indexOf('pre') === -1 ? 'has clients' : s.join(','));
  const lines = BANK.filter(q => q.id !== 'S00').map(q => {
    const t = targetsOf(q).map(p => ABBR[p]).join(' ') || '-';
    const txt = q.format === 'scale' ? '"' + q.s + '"' : q.q;
    return [q.id, stagesLabel(q.stages), 'd' + q.depth + ' ' + q.purpose, q.area, t, q.format, txt].join(' | ') +
      (q.aiOnly ? ' | only if relevant' : '');
  });
  SYSTEM = INSTRUCTIONS + '\n\nQUESTION BANK (id | stages | depth and purpose | area | patterns its answers point to: ap approval, pe perfectionism, sc scarcity, id identity | format | text)\n' + lines.join('\n');
  return SYSTEM;
}

async function callClaude(model, user, schema, maxTokens, timeoutMs) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('no_key');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        system: [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        output_config: { format: { type: 'json_schema', schema } }
      })
    });
    if (!r.ok) throw new Error('anthropic_' + r.status + ' ' + clip(await r.text(), 300));
    const data = await r.json();
    if (data.stop_reason === 'refusal' || data.stop_reason === 'max_tokens') throw new Error('stop_' + data.stop_reason);
    const block = (data.content || []).find(b => b.type === 'text');
    if (!block) throw new Error('no_text_block');
    return JSON.parse(block.text);
  } finally {
    clearTimeout(timer);
  }
}

function personBlock(state, stage) {
  const p = state.profile;
  const stated = p.stated.map(s => s.label).join('; ');
  return [
    'PERSON',
    'Stage: ' + (stage || 'unknown'),
    'Business: ' + (p.business || '(not parsed)'),
    'Now: ' + (p.current || '(not stated)'),
    'Goal: ' + (p.goal || '(not stated)'),
    'Says the problem is: ' + (stated || '(not stated)'),
    'Facts learned: ' + (state.facts.join('; ') || 'none'),
    '',
    'WHAT THEY SHARED AT THE START',
    '"""',
    clip(state.context, 3500),
    '"""'
  ].join('\n');
}
function answersBlock(state, title) {
  if (!state.history.length) return title + '\nnone yet';
  return title + '\n' + state.history.map((h, i) => (i + 1) + '. [' + h.q.id + '] ' + questionLabel(h) + ' > ' + answerLabel(h)).join('\n');
}
function mapLine(map) {
  return map.order.map(p => p + ' ' + map.percentages[p] + '%').join(', ') + ' (evidence ' + map.evidence + ', confidence ' + map.confidence + ')';
}

function startMessage(context) {
  return [
    'WHAT THEY SHARED (voice note transcript or typed, verbatim)',
    '"""', context, '"""',
    '',
    'TASK',
    '1. profile: what they told you. Use "" when something isn\'t stated. stage: your best read. missing: which of current_situation, goal, stated_problem, numbers they haven\'t covered.',
    '2. heard: play back what they said in at most 2 short sentences, second person: their situation, their goal, what they think is in the way. No judgment, no advice. Under 45 words.',
    '3. evidence: pattern signals in what they shared. [] if none.',
    '4. safety_flag.',
    '5. next: the first question. type "bank" with a bank id that fits their stage, or type "clarify" if something essential is missing and no bank question covers it. text: your wording, or "" to keep the bank wording. why: one short internal reason.'
  ].join('\n');
}

function nextMessage(state, stage, candidates, map, used) {
  const noMoreText = used.textUsed >= MAX_TEXT ? ' No more free-text or clarify questions.' : '';
  return [
    personBlock(state, stage),
    '',
    answersBlock(state, 'ANSWERS SO FAR'),
    '',
    'PATTERN READ SO FAR: ' + mapLine(map),
    'Answered: ' + used.n + '. Minimum ' + MIN_Q + ', maximum ' + MAX_Q + '. Free-text questions used: ' + used.textUsed + ' of ' + MAX_TEXT +
      '. Clarify questions used: ' + used.clarifyUsed + ' of ' + MAX_CLARIFY + '.' + noMoreText,
    '',
    'ALLOWED BANK IDS',
    candidates.map(q => q.id).join(', '),
    '',
    'TASK',
    '1. answer_evidence: judge only free text in the LAST answer (#' + used.n + '), meaning a text answer or the "also wrote" part. If there is none, return [].',
    '2. facts: new concrete facts from the last answer (numbers, situation), each under 15 words. Otherwise [].',
    '3. safety_flag.',
    '4. decision: "stop" if the stop rule is met, otherwise "ask".',
    '5. next: if asking, pick from ALLOWED BANK IDS (type "bank") or write a clarify question (type "clarify", id ""). text: your wording, or "" to keep the bank wording. why: one short internal reason. If stopping, return type "bank" with empty id, text and why.'
  ].join('\n');
}

function finishMessage(state, map) {
  const stage = stageOf(state);
  return [
    personBlock(state, stage),
    '',
    answersBlock(state, 'ALL ANSWERS'),
    '',
    'FINAL PATTERN MAP (computed from their answers, use it as given): ' + map.order.map(p => p + ' ' + map.percentages[p] + '%').join(', ') +
      '. Main pattern: ' + map.primary + '. Second: ' + map.secondary + '. Confidence: ' + map.confidence + '.',
    '',
    'WRITE',
    'result (shown to them; second person; Edo\'s voice; English):',
    '- headline: one line naming their main pattern in their situation. Under 14 words.',
    '- said: what they said the problem is, in one sentence.',
    '- pointing: 2 to 4 sentences connecting the problem they named to what they do and what they believe, ending in the pattern. Use their words. Plain and direct, no hedging, no diagnosis.',
    '- cost: what it is costing them in business terms. 1 to 2 sentences.',
    '- shift: what changes when this resolves. 1 to 2 sentences. No promises about numbers.',
    '- pattern_lines: one short line per pattern on how it shows up for them, under 18 words. If a pattern barely shows up, say so plainly. Don\'t restate the percentages.',
    'brief (internal, for Edo before the call; terse):',
    '- summary: 2 sentences on who they are and where they\'re at. stage. numbers: figures they gave, else "". goal.',
    '- stated_problem: what they think is wrong. likely_problem: what the answers point to instead, and why.',
    '- key_quotes: up to 4 short quotes in their words. blind_spots: what they didn\'t name that the answers suggest.',
    '- call_opener: the first question Edo should ask on the call.',
    '- fit: full_recode (deep identity-level work, committed, can invest), sprint (one specific ceiling, now), collective (lighter touch, community), not_yet (not ready or no budget yet), unclear. fit_reason: one sentence.',
    '- flags: anything Edo should know (very early stage, vague answers, contradictions). [] if none.',
    'seed (for their dashboard if they join):',
    '- baseline: where they are now, one line. goal: where they want to be.',
    '- beliefs: up to 3 limiting beliefs in first person, their words where possible.',
    '- behaviors_to_track: up to 3 specific weekly behaviors that would show the pattern loosening.',
    '- first_focus: the first thing to work on, one sentence.'
  ].join('\n');
}

function resolveNext(next, candidates, clarifyUsed, textUsed) {
  if (!next || typeof next !== 'object') return null;
  if (lower(next.type) === 'clarify') {
    const t = tidy(next.text, 200);
    if (t && clarifyUsed < MAX_CLARIFY && textUsed < MAX_TEXT) return clarifyQuestion(clarifyUsed + 1, t);
    return null;
  }
  const id = String(next.id || '').trim().toUpperCase();
  const q = candidates.find(c => c.id === id);
  if (!q) return null;
  let wording = tidy(next.text, 200);
  if (!wording || q.format === 'scale' || wording.length > 160) wording = '';
  return toClient(q, wording);
}

async function aiStart(context) {
  const out = await callClaude(MODEL_DEEP, startMessage(context), START_SCHEMA, 1400, 30000);
  const profile = sanitizeProfile(out.profile);
  const heard = tidy(out.heard, LIMIT.field);
  const contextEvidence = sanitizeEvidence(out.evidence);
  if (out.safety_flag === true) return { mode: 'ai', profile, heard, contextEvidence, safety: true, done: true, question: null };
  const state = { context, heard, profile, contextEvidence, facts: [], history: [] };
  const candidates = BANK.filter(q => q.id !== 'S00' && fitsStage(q, profile.stage));
  let question = resolveNext(out.next, candidates, 0, 0);
  if (!question) { const q = rulesPick(state); question = toClient(q || BY_ID.S00); }
  return { mode: 'ai', profile, heard, contextEvidence, safety: false, done: false, question };
}

async function aiNext(state) {
  const stage = stageOf(state);
  const asked = new Set(state.history.map(h => h.q.id));
  const n = state.history.length;
  const textUsed = state.history.filter(h => h.q.format === 'text').length;
  const clarifyUsed = state.history.filter(h => h.q.kind === 'clarify').length;
  const candidates = BANK.filter(q => !asked.has(q.id) && q.id !== 'S00' && fitsStage(q, stage) &&
    (q.format !== 'text' || textUsed < MAX_TEXT));
  const map = patternMap(state);
  const out = await callClaude(MODEL_FAST, nextMessage(state, stage, candidates, map, { n, textUsed, clarifyUsed }), NEXT_SCHEMA, 900, 25000);

  const lastEvidence = sanitizeEvidence(out.answer_evidence);
  const facts = (Array.isArray(out.facts) ? out.facts : []).slice(0, 5).map(f => tidy(f, LIMIT.fact)).filter(Boolean);
  if (out.safety_flag === true) return { mode: 'ai', lastEvidence, facts, safety: true, done: true, question: null };
  state.history[n - 1].evidence = lastEvidence;

  let done = n >= MAX_Q || (lower(out.decision) === 'stop' && n >= MIN_Q);
  let question = null;
  if (!done) {
    question = resolveNext(out.next, candidates, clarifyUsed, textUsed);
    if (!question) { const q = rulesPick(state); question = q ? toClient(q) : null; }
    if (!question) done = true;
  }
  return { mode: 'ai', lastEvidence, facts, safety: false, done, question };
}

async function aiFinish(state, map) {
  const out = await callClaude(MODEL_DEEP, finishMessage(state, map), FINISH_SCHEMA, 2600, 45000);
  const r = out.result || {}, b = out.brief || {}, s = out.seed || {};
  const list = (arr, n, len) => (Array.isArray(arr) ? arr : []).slice(0, n).map(x => tidy(x, len)).filter(Boolean);
  const lines = {};
  PATTERNS.forEach(p => { lines[p] = tidy(r.pattern_lines && r.pattern_lines[p], 220); });
  const result = {
    headline: tidy(r.headline, 160), said: tidy(r.said, 400), pointing: tidy(r.pointing, 900),
    cost: tidy(r.cost, 400), shift: tidy(r.shift, 400), pattern_lines: lines
  };
  if (!result.headline || !result.pointing) throw new Error('empty_result');
  const fit = lower(b.fit);
  return {
    result,
    brief: {
      summary: tidy(b.summary, 500), stage: tidy(b.stage, 40), numbers: tidy(b.numbers, 300), goal: tidy(b.goal, 300),
      stated_problem: tidy(b.stated_problem, 300), likely_problem: tidy(b.likely_problem, 500),
      key_quotes: list(b.key_quotes, 4, 200), blind_spots: list(b.blind_spots, 4, 200), call_opener: tidy(b.call_opener, 300),
      fit: FITS.indexOf(fit) !== -1 ? fit : 'unclear', fit_reason: tidy(b.fit_reason, 300), flags: list(b.flags, 5, 200)
    },
    seed: {
      baseline: tidy(s.baseline, 300), goal: tidy(s.goal, 300), beliefs: list(s.beliefs, 3, 200),
      behaviors_to_track: list(s.behaviors_to_track, 3, 200), first_focus: tidy(s.first_focus, 300)
    }
  };
}

// ---------- rules-mode brief and seed ----------
function strongBeliefs(state) {
  return state.history
    .filter(h => h.q.kind === 'bank' && BY_ID[h.q.id].format === 'scale' && h.answer.value >= 4)
    .map(h => BY_ID[h.q.id].s);
}
function rulesBrief(state, map) {
  const rev = state.history.find(h => h.q.id === 'S01');
  const texts = state.history.filter(h => h.q.format === 'text' && h.answer.text).map(h => h.answer.text);
  return {
    summary: tidy(state.context, 600), stage: stageOf(state) || 'unknown', numbers: rev ? answerLabel(rev) : '',
    goal: state.profile.goal, stated_problem: state.profile.stated.map(s => s.label).join('; '),
    likely_problem: 'Leading pattern: ' + map.primary + ' (' + map.percentages[map.primary] + '%), then ' +
      map.secondary + ' (' + map.percentages[map.secondary] + '%). Read the context above before the call.',
    key_quotes: texts.slice(0, 4).map(t => tidy(t, 200)), blind_spots: [], call_opener: '',
    fit: 'unclear', fit_reason: 'Rules mode: no AI read of the free text.', flags: ['rules_mode']
  };
}
function rulesSeed(state) {
  return {
    baseline: state.profile.current, goal: state.profile.goal,
    beliefs: strongBeliefs(state).slice(0, 3), behaviors_to_track: [], first_focus: ''
  };
}

// ---------- public actions ----------
async function start(body) {
  const context = clip(String(body.context || '').trim(), LIMIT.context);
  if (context.length < 10) return { error: 'too_short' };
  if (hasKey()) {
    try { return await aiStart(context); } catch (e) { console.error('[diagnostic] AI start failed, using rules:', e.message); }
  }
  return { mode: 'rules', profile: sanitizeProfile({}), heard: '', contextEvidence: [], safety: false, done: false, question: toClient(BY_ID.S00) };
}

async function next(body) {
  const state = sanitizeState(body.state);
  if (!state.history.length) return { error: 'no_answers' };
  if (hasKey() && stageOf(state)) {
    try { return await aiNext(state); } catch (e) { console.error('[diagnostic] AI next failed, using rules:', e.message); }
  }
  const q = rulesPick(state);
  return { mode: 'rules', lastEvidence: [], facts: [], safety: false, done: !q, question: q ? toClient(q) : null };
}

async function finish(body) {
  const state = sanitizeState(body.state);
  const map = patternMap(state);
  let ai = null;
  if (hasKey()) {
    try { ai = await aiFinish(state, map); } catch (e) { console.error('[diagnostic] AI finish failed, using rules:', e.message); }
  }
  return {
    mode: ai ? 'ai' : 'rules',
    percentages: map.percentages, primary: map.primary, secondary: map.secondary, order: map.order, confidence: map.confidence,
    result: ai ? ai.result : null,
    brief: ai ? ai.brief : rulesBrief(state, map),
    seed: ai ? ai.seed : rulesSeed(state),
    answers: answerList(state),
    stage: stageOf(state)
  };
}

async function handle(body) {
  body = body && typeof body === 'object' ? body : {};
  if (body.action === 'start') return start(body);
  if (body.action === 'next') return next(body);
  if (body.action === 'finish') return finish(body);
  return { error: 'unknown_action' };
}

module.exports = {
  handle,
  _internal: { BANK, BY_ID, PATTERNS, patternMap, rulesPick, sanitizeState, toPercent, systemPrompt, startMessage, nextMessage, finishMessage, START_SCHEMA, NEXT_SCHEMA, FINISH_SCHEMA }
};
