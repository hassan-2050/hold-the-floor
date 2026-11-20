// The patient interviewer: scripted, neutral questions. It asks the next
// question only when the turn ends (turn.end), with a short, neutral
// acknowledgement. No speech recognition and no grading of answers.
import places from './question-sets/places.json';
import everyday from './question-sets/everyday.json';
import work from './question-sets/work.json';
import type { QuestionSetId } from '../shared/settings';

export interface QuestionSet {
  id: QuestionSetId;
  title: string;
  questions: string[];
}

export const QUESTION_SETS: Record<QuestionSetId, QuestionSet> = {
  places: places as QuestionSet,
  everyday: everyday as QuestionSet,
  work: work as QuestionSet,
};

const ACKS = ['Thank you.', 'Thanks.', 'I see.', 'Thank you for that.'];

export class Interviewer {
  private i = -1;
  constructor(readonly set: QuestionSet) {}

  get index(): number {
    return this.i;
  }

  get total(): number {
    return this.set.questions.length;
  }

  get current(): string | null {
    return this.set.questions[this.i] ?? null;
  }

  get finished(): boolean {
    return this.i >= this.set.questions.length;
  }

  /** "I wasn't finished": step back so the current question is asked again later. */
  back(): void {
    if (this.i >= 0) this.i--;
  }

  /** The next line to say: acknowledgement + question, or a closing line. */
  next(): { say: string; question: string | null } {
    this.i++;
    const q = this.set.questions[this.i] ?? null;
    if (this.i === 0) return { say: `Let's begin. ${q}`, question: q };
    const ack = ACKS[this.i % ACKS.length]!;
    if (!q) return { say: `${ack} That was the last question. Your results are ready.`, question: null };
    return { say: `${ack} ${q}`, question: q };
  }
}
