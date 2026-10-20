import {
  ORBITAL_COURSE,
  type ModuleInitializationV2,
  type OrbitalCourse,
  type OrbitalLesson,
  type ServiceKey,
} from '@space-sim/game-api';

export interface OrbitalCourseHelper {
  readonly course: OrbitalCourse;
  /** Lists lessons matching the requested difficulty tier. */
  byLevel(level: OrbitalLesson['level']): readonly OrbitalLesson[];
  /** Finds a lesson by ID, or returns undefined. */
  find(id: string): OrbitalLesson | undefined;
}

export const ORBITAL_COURSE_HELPER: ServiceKey<OrbitalCourseHelper> = Object.freeze({
  slot: 'example.orbital-lessons',
  version: '1.0.0',
});

export function createOrbitalCourseHelper(course: OrbitalCourse): OrbitalCourseHelper {
  return Object.freeze<OrbitalCourseHelper>({
    course,
    byLevel(level): readonly OrbitalLesson[] {
      return course.lessons.filter(lesson => lesson.level === level);
    },
    find(id): OrbitalLesson | undefined {
      return course.lessons.find(lesson => lesson.id === id);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(ORBITAL_COURSE_HELPER, createOrbitalCourseHelper(context.use(ORBITAL_COURSE)));
}
