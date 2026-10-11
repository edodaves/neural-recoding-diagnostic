'use strict';
/*
 * Neural Recoding diagnostic: question bank v1.
 *
 * The engine picks from this list one question at a time. To add or edit a
 * question, change it here and redeploy. Nothing else needs to change.
 *
 * Pattern weights:  ap = approval, pe = perfectionism, sc = scarcity, id = identity
 *   'sc'          -> full weight to scarcity
 *   'ap+id'       -> split evenly
 *   'sc.5'        -> half weight
 *   ''            -> no pattern (a positive or neutral answer)
 * Single and multi questions get an automatic "Doesn't apply to me" option
 * unless one of their options already has no weight.
 *
 * Stages: pre (not launched), early (first clients), growing, plateau,
 *         declining, scaling (established, going for the next level)
 * depth:  1 facts, 2 behavior, 3 belief, 4 separates two patterns
 */

const P = { ap: 'approval', pe: 'perfectionism', sc: 'scarcity', id: 'identity' };
const ALL = ['pre', 'early', 'growing', 'plateau', 'declining', 'scaling'];
const RUN = ['early', 'growing', 'plateau', 'declining', 'scaling'];
const PRE = ['pre'];
const UP = ['growing', 'scaling'];
const NEXT = ['growing', 'plateau', 'scaling'];
const TEAMS = ['growing', 'plateau', 'declining', 'scaling'];

function w(spec) {
  const out = {};
  if (!spec) return out;
  const parts = spec.split('+');
  parts.forEach(part => {
    const m = part.match(/^(ap|pe|sc|id)([\d.]*)$/);
    if (!m) throw new Error('Bad weight "' + spec + '"');
    const val = m[2] ? parseFloat(m[2]) : 1 / parts.length;
    out[P[m[1]]] = (out[P[m[1]]] || 0) + val;
  });
  return out;
}

const Q = [];
function add(o) { Q.push(Object.assign({ qw: 1, depth: 2, purpose: 'behavior', domain: 'psych' }, o)); }
function opts(list) { return list.map(([t, s]) => ({ t, w: w(s || '') })); }
function choice(id, stages, area, q, list, extra) { add(Object.assign({ id, stages, area, format: 'single', q, opts: opts(list) }, extra)); }
function multi(id, stages, area, q, list, extra) { add(Object.assign({ id, stages, area, format: 'multi', q, opts: opts(list) }, extra)); }
function scale(id, stages, area, statement, spec, extra) {
  add(Object.assign({ id, stages, area, format: 'scale', q: 'How true does this feel?', s: statement, w: w(spec), depth: 3, purpose: 'belief' }, extra));
}
function text(id, stages, area, q, extra) { add(Object.assign({ id, stages, area, format: 'text', q, depth: 2, purpose: 'open' }, extra)); }

const FACT = { depth: 1, purpose: 'context', domain: 'business' };
const TEST = { depth: 1, purpose: 'test', domain: 'business' };
const SPLIT = { depth: 4, purpose: 'separate', qw: 1.5 };

// ---------- SITUATION AND FACTS ----------
choice('S00', ALL, 'situation', "Where are you right now?", [
  ["I haven't launched yet"], ["I have my first clients"], ["It's growing and I want it faster"],
  ["It's been stuck at the same level"], ["It's going backwards"], ["It's established and I'm going for the next level"]
], Object.assign({}, FACT, { sets: 'stage', stageMap: ['pre', 'early', 'growing', 'plateau', 'declining', 'scaling'] }));
choice('S01', RUN, 'situation', "Roughly what does the business make per month right now?", [
  ["Nothing yet"], ["Under 2k"], ["2k to 10k"], ["10k to 30k"], ["30k to 100k"], ["Over 100k"], ["Rather not say"]
], FACT);
choice('S02', RUN, 'situation', "How long have you been running it?", [
  ["Less than 6 months"], ["6 to 12 months"], ["1 to 3 years"], ["More than 3 years"]
], FACT);
choice('S03', RUN, 'team', "Who works on the business besides you?", [
  ["Just me"], ["A few freelancers"], ["A small team"], ["A team with managers"]
], FACT);
choice('S04', RUN, 'acquisition', "Where do most of your clients come from?", [
  ["Referrals and my network"], ["Content and social media"], ["Outreach: DMs, emails, calls"], ["Paid ads"], ["Partnerships"], ["It's random"]
], FACT);
text('S05', RUN, 'situation', "What's the one number you'd most like to change in the next 90 days, and where is it now?", TEST);
text('S06', ALL, 'growth', "Where do you want to be in 12 months? Be specific.", FACT);
text('S07', ALL, 'situation', "What do you think is the main thing in the way right now?", FACT);
text('S08', ALL, 'situation', "What have you already tried to fix it, and what happened?", { depth: 2, purpose: 'test' });
text('S09', ALL, 'growth', "If nothing changes in the next 12 months, what happens?", { depth: 3, purpose: 'intensity' });
choice('S10', RUN, 'time', "How many hours a week do you put into the business?", [
  ["Under 20"], ["20 to 40"], ["40 to 60"], ["Over 60"]
], FACT);
choice('S11', ALL, 'focus', "How many projects or offers are you running right now?", [
  ["One"], ["Two"], ["Three or more"]
], FACT);

// ---------- ACQUISITION ----------
choice('ACQ01', ALL, 'acquisition', "When you know you should post or reach out but don't, what usually gets in the way?", [
  ["I worry how it'll come across", 'ap'], ["It never feels good enough to send", 'pe'],
  ["Client work comes first, I can't drop it", 'sc'], ["Selling myself doesn't feel like me", 'id'],
  ["Nothing, I do it consistently"]
]);
choice('ACQ02', RUN, 'acquisition', "How many real sales conversations do you have in a normal week?", [
  ["None"], ["1 to 2"], ["3 to 5"], ["More than 5"], ["Not sure"]
], TEST);
multi('ACQ03', ALL, 'visibility', "When you think about putting out more content, what comes up?", [
  ["What will people I know think?", 'ap'], ["I need a better setup or script first", 'pe'],
  ["It takes time I can't spare", 'sc'], ["I'm not a content person", 'id'], ["I'm keen, I just need a plan"]
]);
choice('ACQ04', RUN, 'acquisition', "When a post or campaign doesn't perform, what do you do next?", [
  ["Go quiet for a while", 'ap'], ["Rework it until it's better", 'pe'],
  ["Push out more, faster, because I need results", 'sc'], ["Wonder if this is really for me", 'id'],
  ["Check the numbers and adjust"]
]);
scale('ACQ05', ALL, 'acquisition', "Reaching out to people feels like bothering them.", 'ap');
scale('ACQ06', ALL, 'visibility', "If I post more, people who know me will think I've changed.", 'ap.6+id.4');
choice('ACQ07', RUN, 'acquisition', "If you had twice the leads tomorrow, what would happen?", [
  ["We'd handle it and grow"], ["We'd handle it, but I'd be stretched thin"], ["Delivery would break"],
  ["Leads might not be the real problem"]
], TEST);

// ---------- SALES ----------
choice('SAL01', RUN, 'sales', "On a sales call, when it's time to say the price, what happens?", [
  ["I rush it or soften it", 'ap'], ["I over-explain to make it airtight", 'pe'],
  ["I offer a discount before they ask", 'sc'], ["It feels like someone else is saying it", 'id'],
  ["I say it and stop talking"]
]);
choice('SAL02', RUN, 'sales', "After someone says no, what do you tell yourself?", [
  ["They didn't like me", 'ap'], ["My pitch wasn't good enough yet", 'pe'],
  ["I can't afford to lose deals like that", 'sc'], ["Maybe I'm not cut out for this", 'id'],
  ["Not a fit. Next."]
]);
choice('SAL03', RUN, 'sales', "Out of 10 sales conversations, how many usually buy?", [
  ["0 to 1"], ["2 to 3"], ["4 to 5"], ["6 or more"], ["I don't track it"]
], TEST);
scale('SAL04', RUN, 'sales', "Asking for the sale feels pushy.", 'ap');
scale('SAL05', RUN, 'sales', "When someone hesitates, I feel I have to lower the price to keep them.", 'sc');
choice('SAL06', RUN, 'pricing', "When a prospect asks for a discount, what do you usually do?", [
  ["Give it so they don't think badly of me", 'ap'], ["Justify every detail of the price first", 'pe'],
  ["Give it. A smaller deal beats no deal", 'sc'], ["Give it. Part of me isn't sure I'm worth full price", 'id'],
  ["Hold the price"]
]);

// ---------- PRICING ----------
choice('PRI01', RUN, 'pricing', "When did you last raise your prices?", [
  ["In the last 6 months"], ["6 to 12 months ago"], ["Over a year ago"], ["Never"]
], TEST);
choice('PRI02', RUN, 'pricing', "What's really stopping you from charging more?", [
  ["What clients or peers would think", 'ap'], ["The offer needs to be better first", 'pe'],
  ["Fear of losing clients", 'sc'], ["Charging that doesn't feel like me", 'id'],
  ["Nothing. I'm about to raise them"]
]);
choice('PRI03', RUN, 'pricing', "How did you set your current price?", [
  ["What I thought people would accept", 'ap'], ["Low for now, until the offer is perfect", 'pe'],
  ["What felt safe so I wouldn't lose sales", 'sc'], ["What I felt someone like me could charge", 'id'],
  ["From the value and the numbers"]
]);
scale('PRI04', RUN, 'pricing', "If I raise my prices, my clients will leave.", 'sc');
scale('PRI05', ALL, 'pricing', "People would think I'm greedy if I charged what I really want.", 'ap');
scale('PRI06', ALL, 'pricing', "I'll charge more once I'm more qualified.", 'pe.5+id.5');
scale('PRI07', ALL, 'pricing', "I don't feel like someone who charges premium prices.", 'id');
text('PRI08', PRE, 'pricing', "What price are you planning to start at, and how did you pick it?", { domain: 'business', purpose: 'test' });

// ---------- OFFER ----------
choice('OFF01', RUN, 'offer', "When the offer isn't selling, what's your first move?", [
  ["Ask people what they think before changing anything", 'ap'], ["Rebuild it from scratch", 'pe'],
  ["Cut the price", 'sc'], ["Start something new instead", 'id'],
  ["Talk to buyers and fix the specific gap"]
]);
scale('OFF02', ALL, 'offer', "If it's not perfect, it's not ready.", 'pe');
choice('OFF03', PRE, 'launch', "What would need to be true for you to launch this month?", [
  ["I'd need to know people will like it", 'ap'], ["It would need to be properly finished", 'pe'],
  ["I'd need enough money saved first", 'sc'], ["I'd need to feel like a real business owner", 'id'],
  ["Nothing. I'm launching"]
]);
text('OFF04', ALL, 'offer', "Say what you sell in one sentence, like you would to a stranger.", TEST);
choice('OFF05', ALL, 'offer', "How many times have you changed your offer in the last 6 months?", [
  ["Not at all"], ["Once"], ["2 or 3 times"], ["More than 3 times"], ["I don't have an offer yet"]
], FACT);

// ---------- TEAM AND DELIVERY ----------
choice('TEAM01', RUN, 'team', "What stops you from handing off more of the work?", [
  ["I don't like being the one who asks or corrects", 'ap'], ["Nobody does it as well as me", 'pe'],
  ["I can't afford to hire", 'sc'], ["I don't see myself as a CEO yet", 'id'],
  ["Nothing. I delegate well"]
]);
scale('TEAM02', RUN, 'team', "If I hand it off, it'll be done wrong.", 'pe');
scale('TEAM03', RUN, 'team', "If I stop working this hard, it'll all fall apart.", 'sc');
choice('TEAM04', TEAMS, 'team', "When someone on your team underperforms, what do you do?", [
  ["Avoid the conversation", 'ap'], ["Redo the work myself", 'pe'],
  ["Keep them. Replacing them feels too risky", 'sc'], ["Feel unsure I have the right to call it out", 'id'],
  ["Address it directly"]
], { needsTeam: true });
choice('TEAM05', RUN, 'time', "Where do most of your hours go each week?", [
  ["Delivering to clients"], ["Sales and marketing"], ["Admin and operations"], ["Putting out fires"], ["Building new things"]
], FACT);
scale('TEAM06', RUN, 'team', "It's faster if I just do it myself.", 'pe.6+sc.4');

// ---------- MONEY AND DECISIONS ----------
choice('MON01', RUN, 'money', "When a good month comes in, what do you do with the money?", [
  ["Spend some on things that show I'm doing well", 'ap'], ["Hold it until I have the perfect plan", 'pe'],
  ["Keep it all, in case things go wrong", 'sc'], ["Not sure. Money at this level still feels unreal", 'id'],
  ["Reinvest part of it with a plan"]
]);
scale('MON02', ALL, 'money', "I can't afford to invest in the business right now.", 'sc');
scale('MON03', RUN, 'money', "I need to keep as much money as I can, just in case.", 'sc');
choice('MON04', ALL, 'decisions', "When you face a big call, like a hire, an investment or a new offer, how do you decide?", [
  ["I ask around until enough people agree", 'ap'], ["I research until I'm sure, which takes a long time", 'pe'],
  ["I pick the option that risks the least money", 'sc'], ["I wait until I feel ready", 'id'],
  ["I decide fast and adjust"]
]);
choice('MON05', PRE, 'launch', "What's holding you back from going all in?", [
  ["What my family or friends would say", 'ap'], ["I don't have it all figured out yet", 'pe'],
  ["I can't afford to lose my income", 'sc'], ["I don't see myself as an entrepreneur yet", 'id'],
  ["Nothing. I'm going all in"]
]);
scale('MON06', ALL, 'decisions', "I have to take every opportunity in case it's the last one.", 'sc');
scale('MON07', ALL, 'money', "I feel guilty spending money on myself or the business.", 'sc');
scale('MON08', ALL, 'time', "I feel guilty when I take time off.", 'sc');

// ---------- MARKET ----------
choice('MKT01', ALL, 'market', "When did you last talk to 10 potential clients about their problem?", [
  ["This month"], ["In the last 6 months"], ["Longer ago"], ["Never"]
], TEST);
choice('MKT02', ALL, 'market', "What makes you hesitate to niche down?", [
  ["I don't want to exclude people", 'ap'], ["I need to research more first", 'pe'],
  ["Fewer people means fewer clients", 'sc'], ["I'm not sure I'm an expert in one thing", 'id'],
  ["I'm already niched and it works"]
]);
scale('MKT03', RUN, 'market', "There aren't enough good clients for what I do.", 'sc');
choice('MKT04', ALL, 'market', "How do you know the market is big enough?", [
  ["I've checked the numbers"], ["People keep asking for it"], ["Gut feeling"], ["I don't know"]
], TEST);

// ---------- FOCUS ----------
choice('FOC01', ALL, 'focus', "When something isn't working after a few weeks, what do you usually do?", [
  ["Keep it quiet and hope it turns", 'ap'], ["Go back and perfect it", 'pe'],
  ["Grab whatever brings money in fastest", 'sc'], ["Jump to a new idea", 'id'],
  ["Stick with it and fix what's broken"]
]);
scale('FOC02', ALL, 'focus', "I start strong and lose momentum before it pays off.", 'id');
scale('FOC03', ALL, 'focus', "I'd rather not start than start badly.", 'pe');
scale('FOC04', ALL, 'focus', "I'd rather do it right than do it now.", 'pe');

// ---------- VISIBILITY AND APPROVAL ----------
choice('VIS01', ALL, 'visibility', "How do you talk about your wins?", [
  ["I downplay them", 'ap'], ["I point out what's still not good enough", 'pe'],
  ["I keep quiet in case it doesn't last", 'sc'], ["I feel like I don't deserve the credit", 'id'],
  ["I own them and enjoy them"]
]);
scale('VIS02', ALL, 'visibility', "If I show what I really think, people will judge me.", 'ap');
scale('VIS03', ALL, 'visibility', "It's safer to stay under the radar until I've proven myself.", 'ap.6+pe.4');
choice('VIS04', PRE, 'visibility', "Who knows about your plans?", [
  ["Nobody yet. I'll tell people once it works", 'ap'], ["A few people. I'll share when it's ready", 'pe'],
  ["I talk about it, but it doesn't feel real yet", 'id'], ["Everyone. I'm building in public"]
]);
scale('VIS05', ALL, 'self', "Criticism lands harder than praise.", 'ap');
scale('VIS06', ALL, 'self', "The people close to me wouldn't understand if I went all in.", 'ap');
choice('VIS07', ALL, 'self', "When someone criticizes your work, what happens?", [
  ["I replay it for days", 'ap'], ["I use it as a reason to rework everything", 'pe'],
  ["I worry it'll cost me clients", 'sc'], ["I wonder if they're right about me", 'id'],
  ["I take what's useful and move on"]
]);
scale('VIS08', ALL, 'self', "Saying no to people makes me feel like I'm letting them down.", 'ap');
scale('VIS09', ALL, 'self', "I'd rather be liked than respected.", 'ap');
scale('VIS10', ALL, 'self', "I compare myself to others in my space and feel behind.", 'ap.5+id.5');

// ---------- PERFECTIONISM ----------
scale('PER01', ALL, 'self', "Good enough is just an excuse.", 'pe');
scale('PER02', ALL, 'self', "I need more information or skills before I can really go for it.", 'pe');
choice('PER03', ALL, 'launch', "How long does it usually take you to go from idea to launch?", [
  ["Days"], ["Weeks"], ["Months. I keep improving it", 'pe'], ["It often never launches", 'pe.5+id.5']
]);
scale('PER04', ALL, 'visibility', "A public mistake would be hard to come back from.", 'pe.5+ap.5');
scale('PER05', ALL, 'self', "I feel calmer while I'm still working on something than when it's out.", 'pe');
choice('PER06', ALL, 'launch', "When you're close to finishing something important, what happens?", [
  ["I worry about how it'll be received", 'ap'], ["I find more things to fix", 'pe'],
  ["I worry it won't pay off", 'sc'], ["I lose interest or get distracted", 'id'],
  ["I finish it"]
]);

// ---------- SCARCITY ----------
choice('SCA01', RUN, 'money', "How do you feel in a slow week?", [
  ["Embarrassed. I hope nobody notices", 'ap'], ["I use it to fix everything that isn't right", 'pe'],
  ["Panicked, even if the numbers are fine", 'sc'], ["Like I'm back to who I was before", 'id'],
  ["Fine. It happens"]
]);
scale('SCA02', RUN, 'sales', "If I say no to a client, another one might not come.", 'sc');
choice('SCA03', RUN, 'sales', "Have you taken clients you knew were wrong for you?", [
  ["Often", 'sc'], ["Sometimes", 'sc.5'], ["Rarely"], ["Never"]
]);
scale('SCA04', ALL, 'money', "Even when things go well, I'm waiting for it to dry up.", 'sc');
scale('SCA05', RUN, 'sales', "Every client feels like it could be the last.", 'sc');

// ---------- IDENTITY ----------
scale('IDN01', ALL, 'self', "I know exactly what to do. I just don't do it.", 'id');
scale('IDN02', ALL, 'self', "Part of me feels like I'm pretending.", 'id');
scale('IDN03', ALL, 'growth', "The founders at the level I want are a different kind of person than me.", 'id');
scale('IDN04', ALL, 'growth', "When things start going really well, something seems to go wrong.", 'id');
scale('IDN05', RUN, 'self', "My results so far were more luck than skill.", 'id');
scale('IDN06', ALL, 'self', "I'm not really a business person.", 'id');
choice('IDN07', ALL, 'growth', "Right after a breakthrough, what tends to happen?", [
  ["I worry people will expect more from me", 'ap'], ["I focus on everything that still isn't right", 'pe'],
  ["I hold on tight in case it doesn't last", 'sc'], ["I slip back into old habits", 'id'],
  ["I build on it"]
]);
choice('IDN08', ALL, 'growth', "When you picture yourself at the level you want, how does it feel?", [
  ["Exposed", 'ap'], ["Like there'd be a lot more to get right", 'pe'],
  ["Like I'd have more to lose", 'sc'], ["Like it's someone else", 'id'],
  ["Like it's where I belong"]
]);
scale('IDN09', ALL, 'growth', "If I'm honest, I'm not sure I'd be comfortable at the level I say I want.", 'id');
scale('IDN10', RUN, 'pricing', "When I imagine charging 3x what I charge now, I feel like a fraud.", 'id');

// ---------- SEPARATING TWO PATTERNS ----------
choice('DIS01', RUN, 'pricing', "When you think about raising your price, which bothers you more?", [
  ["Losing clients", 'sc'], ["What clients would think of me", 'ap'], ["Neither"]
], Object.assign({}, SPLIT, { pair: ['approval', 'scarcity'] }));
choice('DIS02', ALL, 'launch', "When you hold something back, is it more because...", [
  ["It isn't good enough yet", 'pe'], ["I'm worried how people will react", 'ap'], ["I don't hold things back"]
], Object.assign({}, SPLIT, { pair: ['approval', 'perfectionism'] }));
choice('DIS03', RUN, 'pricing', "When you don't charge more, is it more about...", [
  ["The risk of losing money", 'sc'], ["Not feeling like someone who charges that", 'id'], ["Neither"]
], Object.assign({}, SPLIT, { pair: ['scarcity', 'identity'] }));
choice('DIS04', ALL, 'focus', "When you put off the important thing, is it more...", [
  ["I'm not ready yet", 'pe'], ["It doesn't feel like me", 'id'], ["I don't put it off"]
], Object.assign({}, SPLIT, { pair: ['perfectionism', 'identity'] }));
choice('DIS05', ALL, 'visibility', "When you hold back from showing up bigger, is it more...", [
  ["What people would say", 'ap'], ["It doesn't fit how I see myself", 'id'], ["I don't hold back"]
], Object.assign({}, SPLIT, { pair: ['approval', 'identity'] }));
choice('DIS06', ALL, 'decisions', "When you hesitate on a big decision, is it more...", [
  ["I want to get it exactly right", 'pe'], ["I'm scared to lose what I have", 'sc'], ["I don't hesitate"]
], Object.assign({}, SPLIT, { pair: ['perfectionism', 'scarcity'] }));
choice('DIS07', ALL, 'visibility', "If nobody would ever see the result, would you move faster?", [
  ["Much faster", 'ap'], ["A bit faster", 'ap.5'], ["Same speed"]
], Object.assign({}, SPLIT, { test: 'approval' }));
choice('DIS08', ALL, 'money', "If your income were guaranteed for the next 12 months, what would change?", [
  ["Almost everything", 'sc'], ["A few decisions", 'sc.5'], ["Not much"]
], Object.assign({}, SPLIT, { test: 'scarcity' }));
choice('DIS09', ALL, 'launch', "If mistakes had no consequences, would you ship more?", [
  ["Much more", 'pe'], ["A bit more", 'pe.5'], ["No difference"]
], Object.assign({}, SPLIT, { test: 'perfectionism' }));
choice('DIS10', ALL, 'growth', "If you woke up already at your goal, would it feel like you?", [
  ["Not really", 'id'], ["Partly", 'id.5'], ["Yes"]
], Object.assign({}, SPLIT, { test: 'identity' }));
multi('DIS11', ALL, 'self', "Which of these sound like you?", [
  ["I underclaim so no one can say I'm overselling", 'ap'],
  ["I've rebuilt the same thing more than twice without shipping it", 'pe'],
  ["I hesitate to raise prices even when I'm busy", 'sc'],
  ["Success feels slightly unreal, like it happened to someone else", 'id'],
  ["None of these"]
], Object.assign({}, SPLIT, { purpose: 'recognize' }));
multi('DIS12', ALL, 'self', "Any of these familiar?", [
  ["I feel relief when a launch gets delayed", 'ap'],
  ["I feel calmer revising than right before publishing", 'pe'],
  ["I panic in slow weeks even when the numbers are fine", 'sc'],
  ["I slip back into old habits right after a breakthrough", 'id'],
  ["None of these"]
], Object.assign({}, SPLIT, { purpose: 'recognize' }));
multi('DIS13', RUN, 'self', "Which of these have you done in the last 3 months?", [
  ["Deleted a post before publishing it", 'ap'], ["Delayed a launch to fix one more thing", 'pe'],
  ["Said yes to a client I knew was wrong for me", 'sc'], ["Known the next move and not made it", 'id'],
  ["None of these"]
], Object.assign({}, SPLIT, { purpose: 'recognize' }));
multi('DIS14', PRE, 'launch', "Which of these have you done in the last 3 months?", [
  ["Kept my plans quiet so nobody could judge them", 'ap'], ["Signed up for another course before starting", 'pe'],
  ["Stayed in a job I want out of because it feels safer", 'sc'], ["Thought “people like me don't do this”", 'id'],
  ["None of these"]
], Object.assign({}, SPLIT, { purpose: 'recognize' }));

// ---------- HOW DEEP IT GOES (open answers read by the AI) ----------
choice('INT01', ALL, 'self', "How long has this been going on?", [
  ["A few weeks"], ["A few months"], ["Over a year"], ["As long as I can remember"]
], { depth: 3, purpose: 'intensity' });
choice('INT02', ALL, 'self', "Does the same pattern show up outside business, like in training or money?", [
  ["Yes, a lot"], ["Sometimes"], ["Not really"]
], { depth: 3, purpose: 'intensity' });
text('INT03', ALL, 'growth', "What is this costing you right now? Money, time, anything else.", { depth: 3, purpose: 'intensity' });
text('INT04', ALL, 'self', "What do you tell yourself right before you hold back?", { depth: 3, purpose: 'belief' });
text('INT05', ALL, 'growth', "If this were fixed, what's the first thing you'd do?", { depth: 2, purpose: 'open' });
text('INT06', ALL, 'self', "What's the story you tell yourself about why you're not there yet?", { depth: 3, purpose: 'belief' });
text('INT07', ALL, 'self', "What would someone who knows you well say is really holding you back?", { depth: 3, purpose: 'blindspot' });
text('INT08', ALL, 'self', "What's the part of your business you avoid thinking about?", { depth: 3, purpose: 'blindspot' });

// ---------- NOT LAUNCHED YET ----------
choice('PRE01', PRE, 'launch', "What's stopping you from launching this month?", [
  ["Worried what people will think", 'ap'], ["It's not ready yet", 'pe'],
  ["I can't afford for it to fail", 'sc'], ["I don't feel like a real entrepreneur yet", 'id'],
  ["Nothing. I'm launching"]
]);
choice('PRE02', PRE, 'launch', "How long have you been planning this?", [
  ["Less than 3 months"], ["3 to 12 months"], ["Over a year"], ["Years, on and off"]
], FACT);
choice('PRE03', PRE, 'launch', "If you launched and it failed, what would that mean to you?", [
  ["People would see me fail", 'ap'], ["I launched too early", 'pe'],
  ["I'd lose money I can't afford to lose", 'sc'], ["I'm not cut out for this", 'id'],
  ["I'd learn and go again"]
]);
text('PRE04', PRE, 'launch', "What's the first step you keep not taking?", { purpose: 'test' });
choice('PRE05', PRE, 'launch', "Where does most of your business time go right now?", [
  ["Watching what others are doing", 'ap.5+id.5'], ["Learning and planning", 'pe'],
  ["Keeping my income safe while I figure it out", 'sc'], ["Thinking about who I'd need to become", 'id'],
  ["Building and selling"]
]);
scale('PRE06', PRE, 'money', "I'll start once I have enough saved.", 'sc');
scale('PRE07', PRE, 'launch', "I need one more course or certification before I start.", 'pe');
scale('PRE08', PRE, 'self', "Starting a business isn't something people like me usually do.", 'id');
scale('PRE09', PRE, 'visibility', "I'm waiting until I'm sure people will like it.", 'ap');

// ---------- THE NEXT LEVEL ----------
choice('NXT01', NEXT, 'growth', "What's the next level really about for you?", [
  ["Being seen as a serious player", 'ap'], ["Finally getting the systems right", 'pe'],
  ["Never worrying about money again", 'sc'], ["Becoming the person who runs something bigger", 'id'],
  ["Simply bigger numbers"]
]);
text('NXT02', NEXT, 'growth', "What got you here that won't get you there?", { depth: 3, purpose: 'belief' });
text('NXT03', RUN, 'growth', "What's the scariest move you know you should make?", { purpose: 'test' });
scale('NXT04', UP, 'growth', "The bigger it gets, the more there is to lose.", 'sc');
scale('NXT05', NEXT, 'visibility', "Bigger means more people watching, and that makes me hold back.", 'ap');
scale('NXT06', NEXT, 'growth', "I'd need to be a different person to run a business at that level.", 'id');
choice('NXT07', RUN, 'growth', "How do you feel around founders a few levels ahead of you?", [
  ["I watch what I say", 'ap'], ["I notice everything I haven't figured out", 'pe'],
  ["I wonder how they can afford the risk", 'sc'], ["Like I don't belong yet", 'id'],
  ["Excited. I learn fast"]
]);

// ---------- STUCK OR GOING BACKWARDS ----------
choice('DEC01', ['declining'], 'growth', "Since things started going backwards, what have you done most?", [
  ["Kept it from people around me", 'ap'], ["Redone things that were working", 'pe'],
  ["Cut costs and taken any work I can get", 'sc'], ["Questioned whether I'm meant for this", 'id'],
  ["Found the cause and started fixing it"]
]);
text('DEC02', ['declining'], 'situation', "What changed right before it started going backwards?", { purpose: 'test' });
scale('DEC03', ['declining', 'plateau'], 'self', "Part of me thinks I'm not cut out for this.", 'id');
text('PLA01', ['plateau'], 'situation', "What do you think keeps you at this level?", { purpose: 'test' });
text('PLA02', ['plateau', 'growing'], 'growth', "What have you known you should change for months?", { purpose: 'test' });
scale('PLA03', ['plateau'], 'growth', "This level is comfortable, even if I say I want more.", 'id');

// ---------- UNIT ECONOMICS ----------
choice('UE01', RUN, 'unit_economics', "Do you know what a client is worth over time and what it costs to get one?", [
  ["Yes, both"], ["Roughly"], ["Only one of them"], ["No"]
], TEST);
text('UE02', RUN, 'unit_economics', "Roughly what does a client pay you in total, and what does it cost to get one?", TEST);
choice('UE03', RUN, 'unit_economics', "What's your profit margin, roughly?", [
  ["Under 20%"], ["20 to 40%"], ["40 to 60%"], ["Over 60%"], ["I don't know"]
], TEST);
choice('UE04', RUN, 'unit_economics', "Why do you think margins are thin?", [
  ["I underprice so people say yes", 'ap'], ["I over-deliver to make it perfect", 'pe'],
  ["I take low-paying work to keep cash coming in", 'sc'], ["I don't feel I can charge more yet", 'id'],
  ["Costs I can't control"]
], { aiOnly: true });
choice('UE05', RUN, 'unit_economics', "Getting clients costs more than you'd like. What have you done about it?", [
  ["Kept going. Stopping would look like failing", 'ap'], ["Kept tweaking the ads and the funnel", 'pe'],
  ["Cut spend to protect cash", 'sc'], ["Not much. It doesn't feel like my area", 'id'],
  ["Raised prices or improved conversion"]
], { aiOnly: true });
text('UE06', RUN, 'unit_economics', "What would change if that one number were fixed?", { purpose: 'open' });

// ---------- checks ----------
(function validate() {
  const seen = new Set();
  Q.forEach(q => {
    if (seen.has(q.id)) throw new Error('Duplicate question id ' + q.id);
    seen.add(q.id);
    if (!q.stages || !q.stages.length) throw new Error('No stages on ' + q.id);
    if ((q.format === 'single' || q.format === 'multi') && (!q.opts || q.opts.length < 2)) throw new Error('Too few options on ' + q.id);
  });
})();

module.exports = Q;
