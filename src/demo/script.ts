// The demo script shown in the prompter window (docked above the app and
// never recorded). Pure: maps the app's state to what to say and do next.
// Answers match the "Places and things you like" question set.

export interface DemoState {
  screen: string;
  sheet: string | null;
  /** Calibration step in progress, if any. */
  calStep: 'rest' | 'press' | 'question' | null;
  lipsReady: boolean;
  /** Pressed-lip holds are on (the calibration press was firm enough). */
  pressEnabled: boolean;
  /** The warm-up answer has been given (calibration step 3 ran). */
  warmupDone: boolean;
  questionIndex: number;
  agentSpeaking: boolean;
  cameraOn: boolean;
}

export interface DemoStep {
  part: string;
  /** Lines to read aloud. */
  say?: string;
  /** What to do (shown highlighted). */
  act?: string;
  /** More to read after the action. */
  then?: string;
}

const PARTS = 7;
const part = (n: number, name: string): string => `Part ${n} of ${PARTS} · ${name}`;

const ANSWERS: Record<number, DemoStep> = {
  1: {
    part: part(5, 'Answer 1: a normal answer'),
    say: 'I like the old park near my house. It has tall trees, a small lake, and quiet benches in the shade.',
    act: 'Then stop talking. The agent replies about a second after you finish.',
  },
  2: {
    part: part(5, 'Answer 2: a silent block'),
    say: 'On the way I pass a bakery, a bus stop, and…',
    act: 'PRESS YOUR LIPS FIRMLY TOGETHER, as in calibration step 2, and keep them still for 3 seconds. Left: “Would have cut in here”. Right: “Holding — lips pressed”. Then finish:',
    then: '…a small bookshop with a green door.',
  },
  3: {
    part: part(5, 'Answer 3: about to say the next word'),
    say: 'My favourite room is my study. It has a big window, a wooden desk, and…',
    act: 'Stop with your LIPS SLIGHTLY OPEN AND STILL, as if about to say the next word, for 3 seconds. Right: “Holding — lips set”. Then finish:',
    then: '…shelves full of old books.',
  },
  4: {
    part: part(6, 'Answer 4: camera covered'),
    say: 'Last year I visited my grandparents in the mountains.',
    act: 'Now COVER THE CAMERA with your hand and KEEP TALKING the whole time it is covered (about 4 seconds). Banner: “Camera cues paused”. Uncover it, then stop:',
    then: 'We walked every evening, the air was cool and fresh, and we cooked dinner together.',
  },
};

const ANSWER_2_SET: DemoStep = {
  part: part(5, 'Answer 2: a silent block'),
  say: 'On the way I pass a bakery, a bus stop, and…',
  act: 'FREEZE with your LIPS SLIGHTLY OPEN AND STILL, mouth ready for the next word, for 3 seconds (pressed-lip holds are off this session: your calibration press was soft). Left: “Would have cut in here”. Right: “Holding — lips set”. Then finish:',
  then: '…a small bookshop with a green door.',
};

export function demoStep(s: DemoState): DemoStep {
  switch (s.screen) {
    case 'welcome':
      return {
        part: part(1, 'Welcome'),
        say: 'Voice assistants end your turn after a fixed silence. If you pause, search for a word, or stutter, they cut you off. Hold the Floor uses my own camera to see that I am still mid-turn, and waits.',
        act: 'Click Start.',
      };
    case 'consent':
      return {
        part: part(2, 'Consent'),
        say: 'Camera and microphone are separate choices. The microphone gives loudness only, video never leaves this computer, and telemetry is off.',
        act: 'Click “Agree and continue”.',
      };
    case 'setup':
      return {
        part: part(3, 'Setup'),
        say: 'SmartSpectra first checks that this computer and camera can measure.',
        act: 'Click “Check readiness” (about 25 seconds; you can trim the wait later), then “Continue to calibration”.',
      };
    case 'calibration':
      if (s.calStep === 'rest') return { part: part(4, 'Calibration · step 1'), act: 'Relax your face and stay silent for 10 seconds.' };
      if (s.calStep === 'press') return { part: part(4, 'Calibration · step 2'), act: 'Press your lips FIRMLY together for 5 seconds. Press just as firmly in answer 2 later.' };
      if (s.calStep === 'question') {
        return { part: part(4, 'Calibration · step 3'), say: 'This morning I made tea, read the news, and walked to my desk.', act: 'Then click “I’ve answered”.' };
      }
      if (s.warmupDone) return { part: part(4, 'Calibration done'), act: 'Click “Start the conversation”.' };
      if (s.lipsReady) return { part: part(4, 'Calibration · step 3'), act: 'Listen to the warm-up question.' };
      return {
        part: part(4, 'Calibration'),
        say: 'Calibration learns my resting face. It takes about 45 seconds.',
        act: 'Sit back so your shoulders and chest are in view. When Lips and Head say “seen”, click Begin.',
      };
    case 'conversation': {
      if (!s.cameraOn && s.questionIndex >= 5) {
        return { part: part(7, 'Results'), act: 'Click “End and see results”.' };
      }
      if (s.questionIndex >= 5) {
        return {
          part: part(6, 'Stop sensing'),
          say: 'Esc turns the camera and microphone off at once.',
          act: 'Press Esc (the Camera on badge goes off), then click “End and see results”.',
        };
      }
      // A soft calibration press turns pressed-lip holds off: show the block
      // with the lips-set posture instead, which holds reliably.
      const a = s.questionIndex === 2 && !s.pressEnabled ? ANSWER_2_SET : ANSWERS[s.questionIndex];
      if (!a) return { part: part(5, 'Conversation'), act: 'Listen to the question.' };
      return s.agentSpeaking ? { ...a, act: `Listen to the question, then answer. ${a.act ?? ''}`.trim() } : a;
    }
    case 'results':
      return {
        part: part(7, 'Results'),
        say: 'Same session, same input. A fixed two-second timer would have cut me off. Hold the Floor waited, then replied quickly.',
        act: 'Under “Save this session”, type Demo session and click “Save numbers”. Then close the app window to finish the recording.',
      };
    default:
      return { part: 'Demo', act: '' };
  }
}
