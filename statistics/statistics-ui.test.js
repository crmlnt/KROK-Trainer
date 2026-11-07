const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "statistics.html"), "utf8");
const script = fs.readFileSync(path.join(__dirname, "statistics.js"), "utf8");

function createStatisticsDom({ getUser = async () => ({ data: { user: null }, error: null }), loadStatisticsData } = {}) {
  const dom = new JSDOM(html, {
    runScripts: "outside-only",
    url: "https://example.test/statistics/statistics.html"
  });
  const { window } = dom;
  const filters = {
    ALL_TIME: "all_time",
    LAST_90_DAYS: "last_90_days",
    LAST_30_DAYS: "last_30_days",
    LAST_7_DAYS: "last_7_days"
  };
  window.KrokAnalytics = { TIME_FILTERS: filters };
  window.StatisticsIntegration = {
    loadStatisticsData,
    WEAK_SUBJECT_MIN_QUESTIONS: 10,
    KROK_PASS_THRESHOLD: 64,
    getWeakSubjectStatus: () => "strong",
    formatPercentage: value => value === null ? "—" : `${value}%`,
    formatThresholdDistance: () => "At threshold"
  };
  window.StatisticsPageController = {
    createViewNavigator() {
      let state = { mode: "dashboard", filter: filters.ALL_TIME, subject: null, krok: null };
      return {
        getState: () => ({ ...state }),
        selectFilter: filter => (state = { ...state, filter }),
        openSubject: (subject, krok) => (state = { ...state, mode: "subject", subject, krok }),
        showDashboard: () => (state = { ...state, mode: "dashboard", subject: null, krok: null })
      };
    },
    updateChartInstance: current => current || {}
  };
  window.Chart = function Chart() {};
  window.supabaseClient = {
    auth: { getUser }
  };
  window.eval(script);
  return dom;
}

test("subject names render as text in Weak Subjects and Performance by Subject", () => {
  const dom = createStatisticsDom();
  const maliciousSubject = '<img data-xss="subject" src=x onerror="alert(1)">Anatomy';
  const stat = {
    subject: maliciousSubject,
    questions: 10,
    correct: 7,
    exams: 1,
    accuracy: 70,
    trend: { status: "insufficient_data", krok: 1 },
    byKrok: [{ krok: 1 }]
  };

  dom.window.eval(`renderWeakSubjects(${JSON.stringify([stat])}, "all_time", "No data")`);
  assert.equal(dom.window.document.querySelector(".weak-subject-title-row h3").textContent, maliciousSubject);
  assert.equal(dom.window.document.querySelector('[data-xss="subject"]'), null);

  const view = {
    filter: "all_time",
    window: { start: null, end: 1 },
    coverage: {},
    totalExams: 1,
    totalQuestions: 10,
    overallAccuracy: 70,
    bestScore: 70,
    krok1: { exams: 1, accuracy: 70 },
    krok2: { exams: 0, accuracy: null },
    subjectStats: [stat],
    progress: []
  };
  dom.window.eval(`renderStatisticsView(${JSON.stringify(view)})`);
  assert.equal(dom.window.document.querySelector(".subject-stat-label").textContent, maliciousSubject);
  assert.equal(dom.window.document.querySelector('[data-xss="subject"]'), null);
  dom.window.close();
});

const settle = () => new Promise(resolve => setImmediate(resolve));
for (const missingError of [false,true]) test(`Statistics: missing session is sign-in, not load error (SDK error=${missingError})`,async t=>{
 let reads=0;
 const dom=createStatisticsDom({getUser:async()=>({data:{user:null},error:missingError?{name:'AuthSessionMissingError',message:'Auth session missing!'}:null}),loadStatisticsData:async()=>{reads++;}});
 t.after(()=>dom.window.close());await settle();
 const d=dom.window.document;
 assert.equal(d.getElementById('loginRequired').hidden,false);
 assert.equal(d.getElementById('statisticsError').hidden,true);
 assert.equal(d.getElementById('statisticsLoading').hidden,true);
 assert.equal(d.querySelector('#loginRequired h2').textContent,'Sign in required');
 assert.equal(d.querySelector('#loginRequired a').textContent,'Sign In');
 assert.equal(reads,0);
});

test('Statistics: real Auth failure shows dedicated error and retry can recover to sign-in',async t=>{
 let failure=true;
 const dom=createStatisticsDom({getUser:async()=>({data:{user:null},error:failure?{name:'AuthRetryableFetchError',message:'Network unavailable'}:null})});
 dom.window.console.error=()=>{};t.after(()=>dom.window.close());await settle();
 const d=dom.window.document;
 assert.equal(d.getElementById('statisticsError').hidden,false);
 assert.equal(d.getElementById('loginRequired').hidden,true);
 assert.equal(d.getElementById('statisticsLoading').hidden,true);
 assert.equal(d.querySelector('#statisticsError h2').textContent,'Unable to load statistics');
 assert.equal(d.querySelector('#statisticsError p').textContent,"We couldn't load your statistics right now. Please try again.");
 failure=false;d.getElementById('statisticsRetry').click();await settle();
 assert.equal(d.getElementById('statisticsError').hidden,true);
 assert.equal(d.getElementById('loginRequired').hidden,false);
 assert.match(d.querySelector('#statisticsLoading p').textContent,/Loading/);
});

test('Statistics: data failure is distinct from empty and duplicate retries do not overlap',async t=>{
 let failure=true,reads=0,release;
 const dom=createStatisticsDom({getUser:async()=>({data:{user:{id:'test-user'}},error:null}),loadStatisticsData:async()=>{reads++;if(failure)throw Error('Data unavailable');return new Promise(resolve=>{release=()=>resolve({sessions:[],questionRecords:[]});});}});
 dom.window.console.error=()=>{};t.after(()=>dom.window.close());await settle();
 const d=dom.window.document;
 assert.equal(d.getElementById('statisticsError').hidden,false);
 assert.equal(d.getElementById('emptyStatistics').hidden,true);
 failure=false;d.getElementById('statisticsRetry').click();await settle();
 d.getElementById('statisticsRetry').click();await settle();assert.equal(reads,2);
 assert.equal(d.getElementById('statisticsLoading').hidden,false);
 release();await settle();
 assert.equal(d.getElementById('emptyStatistics').hidden,false);
 assert.equal(d.getElementById('statisticsError').hidden,true);
 assert.equal(d.getElementById('statisticsContent').hidden,true);
});
