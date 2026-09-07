/**
 * @file prompts.ts
 * @description Standardized MCP prompts exposed via WebMCP for autonomous teaching,
 * classroom observation, error correction, and interactive tutoring.
 */

import type { WebMcpPrompt } from './types';

export const teachCurriculumLessonPrompt: WebMcpPrompt<{
  topic: string;
  level?: string;
  style?: string;
}> = {
  name: 'teach_curriculum_lesson',
  description:
    'Structures and executes a complete visual, interactive chalkboard lesson on any topic using real-time chalk drawings, voice explanations, and student practice problems.',
  arguments: [
    {
      name: 'topic',
      description: 'The educational subject or topic to teach (e.g. "Pythagorean Theorem", "Photosynthesis", "Binary Search Trees").',
      required: true,
    },
    {
      name: 'level',
      description: 'Target audience grade/difficulty (e.g. "Middle School", "High School", "College", "Beginner").',
      required: false,
    },
    {
      name: 'style',
      description: 'Pedagogical style (e.g. "Visual & Geometric", "Socratic Discovery", "Step-by-Step Proof").',
      required: false,
    },
  ],
  handler: ({ topic, level = 'High School', style = 'Visual & Geometric' }) => {
    return {
      description: `Lesson Plan Prompt for: ${topic} (${level})`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are the Chalkboard Master, an autonomous AI instructor leading a live collaborative classroom on "${topic}" (Level: ${level}, Style: ${style}).

Follow this structured teaching flow:
1. INTRODUCE TOPIC:
   - Call \`chalkboard_write_text\` to place a clear lesson title and key formulas at the top of the canvas.
   - Call \`chalkboard_speak_narration\` to welcome students and state the learning objective out loud.

2. DRAW VISUAL DIAGRAM:
   - Call \`chalkboard_draw_chalk\` and \`chalkboard_insert_shape\` to sketch clear geometric figures, coordinate axes, or concept diagrams.
   - Label key components with \`chalkboard_write_text\` (e.g. sides "a", "b", "c" or variable names).

3. WALK THROUGH WORKED EXAMPLE:
   - Write out a step-by-step calculation or proof.
   - Use \`chalkboard_highlight_area\` (type="focus") to emphasize critical steps as you explain them.

4. POSE STUDENT PRACTICE CHALLENGE:
   - Call \`chalkboard_highlight_area\` (type="answer_box") to create a designated workspace for students on the board.
   - Post the practice question in chat with \`chalkboard_send_chat\` and speak the prompt.

5. OBSERVE & ADAPT:
   - Call \`chalkboard_get_state\` to inspect student strokes drawn on the canvas.
   - If an error is detected: circle the mistake with \`chalkboard_highlight_area\` (type="correction") and provide a gentle hint.
   - When correct: celebrate with \`chalkboard_highlight_area\` (type="praise") and advance the lesson!`,
          },
        },
      ],
    };
  },
};

export const observeAndCorrectBoardPrompt: WebMcpPrompt<{
  expectedAnswer?: string;
  studentName?: string;
}> = {
  name: 'observe_and_correct_board',
  description:
    'Directs the agent to observe student work on the canvas, diagnose mistakes, circle errors with corrective chalk annotations, and offer encouraging hints.',
  arguments: [
    {
      name: 'expectedAnswer',
      description: 'The expected numerical, algebraic, or diagrammatic answer.',
      required: false,
    },
    {
      name: 'studentName',
      description: 'Name of the student whose work is being reviewed.',
      required: false,
    },
  ],
  handler: ({ expectedAnswer, studentName = 'Student' }) => {
    return {
      description: `Classroom Observation & Correction for ${studentName}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are observing the collaborative classroom canvas. A student (${studentName}) has attempted a problem.
Expected solution context: ${expectedAnswer || 'Analyze based on the current lesson topic on the board.'}

Your task:
1. Call \`chalkboard_get_state\` to inspect newly added student strokes and text.
2. Evaluate if the student's drawing or calculation is correct.
3. If INCORRECT:
   - Do NOT simply erase their work.
   - Use \`chalkboard_highlight_area\` (type="correction") around the specific mistake.
   - Speak an encouraging hint with \`chalkboard_speak_narration\` and post guidance in \`chalkboard_send_chat\`.
4. If CORRECT:
   - Call \`chalkboard_highlight_area\` (type="praise") and draw a star or checkmark.
   - Praise ${studentName} out loud!`,
          },
        },
      ],
    };
  },
};

export const socraticDialoguePrompt: WebMcpPrompt<{
  topic: string;
}> = {
  name: 'socratic_classroom_dialogue',
  description:
    'Guides students through discovery via sequential inquiry, dynamic chalk hints, and interactive questions.',
  arguments: [
    {
      name: 'topic',
      description: 'The concept to explore through inquiry.',
      required: true,
    },
  ],
  handler: ({ topic }) => {
    return {
      description: `Socratic Dialogue: ${topic}`,
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `You are leading a Socratic discovery session on "${topic}".
Instead of giving immediate direct answers:
1. Ask guiding questions in \`chalkboard_send_chat\` and \`chalkboard_speak_narration\`.
2. Draw partial visual diagrams or clue sketches with \`chalkboard_draw_chalk\`.
3. Wait for student input and adapt your next question based on their reasoning.`,
          },
        },
      ],
    };
  },
};

/** All registered Chalkboard WebMCP prompts */
export const ALL_CHALKBOARD_PROMPTS: WebMcpPrompt[] = [
  teachCurriculumLessonPrompt,
  observeAndCorrectBoardPrompt,
  socraticDialoguePrompt,
];
