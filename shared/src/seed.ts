/**
 * The syllabus structure is static seed data shared by every device, so it
 * never needs to sync — only task *status* changes (and deletions) are events.
 */

export interface SeedTask {
  taskId: string;
  title: string;
}

export interface SeedChapter {
  chapterId: string;
  title: string;
  tasks: SeedTask[];
}

export interface SeedSubject {
  subjectId: string;
  title: string;
  chapters: SeedChapter[];
}

export const SEED_SUBJECTS: SeedSubject[] = [
  {
    subjectId: 'math',
    title: 'Mathematics',
    chapters: [
      {
        chapterId: 'math-algebra',
        title: 'Algebra',
        tasks: [
          { taskId: 'math-algebra-1', title: 'Linear equations worksheet' },
          { taskId: 'math-algebra-2', title: 'Quadratic equations practice' },
          { taskId: 'math-algebra-3', title: 'Polynomials chapter test' },
        ],
      },
      {
        chapterId: 'math-geometry',
        title: 'Geometry',
        tasks: [
          { taskId: 'math-geometry-1', title: 'Triangles: theorems & proofs' },
          { taskId: 'math-geometry-2', title: 'Circles exercise set' },
        ],
      },
    ],
  },
  {
    subjectId: 'science',
    title: 'Science',
    chapters: [
      {
        chapterId: 'science-physics',
        title: 'Physics: Motion',
        tasks: [
          { taskId: 'science-physics-1', title: 'Laws of motion notes' },
          { taskId: 'science-physics-2', title: 'Numericals: velocity & acceleration' },
          { taskId: 'science-physics-3', title: 'Motion graphs quiz' },
        ],
      },
      {
        chapterId: 'science-chemistry',
        title: 'Chemistry: Atoms',
        tasks: [
          { taskId: 'science-chemistry-1', title: 'Atomic structure summary' },
          { taskId: 'science-chemistry-2', title: 'Periodic table flashcards' },
        ],
      },
    ],
  },
];

export const SEED_STUDENT_ID = 'student-1';
