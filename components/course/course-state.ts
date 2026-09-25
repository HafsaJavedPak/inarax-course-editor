import type { Course, CourseModule, LessonRef, LevelId } from "@/lib/course"

export type CourseAction =
  | { type: "addModule"; levelId: LevelId; module: CourseModule }
  | { type: "updateModule"; levelId: LevelId; moduleId: string; patch: Partial<Pick<CourseModule, "title" | "summary">> }
  | { type: "removeModule"; levelId: LevelId; moduleId: string }
  | { type: "moveModule"; levelId: LevelId; moduleId: string; offset: -1 | 1 }
  | { type: "addLesson"; levelId: LevelId; moduleId: string; lesson: LessonRef }
  | { type: "renameLesson"; levelId: LevelId; moduleId: string; lessonId: string; title: string }
  | { type: "removeLesson"; levelId: LevelId; moduleId: string; lessonId: string }
  | { type: "moveLesson"; levelId: LevelId; moduleId: string; lessonId: string; offset: -1 | 1 }

function move<T extends { id: string }>(items: T[], id: string, offset: number): T[] {
  const index = items.findIndex((item) => item.id === id)
  const target = index + offset
  if (index < 0 || target < 0 || target >= items.length) return items
  const next = [...items]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  return next
}

function mapModules(
  course: Course,
  levelId: LevelId,
  update: (modules: CourseModule[]) => CourseModule[]
): Course {
  return {
    ...course,
    levels: course.levels.map((level) =>
      level.id === levelId ? { ...level, modules: update(level.modules) } : level
    ),
  }
}

function mapModule(
  course: Course,
  levelId: LevelId,
  moduleId: string,
  update: (module: CourseModule) => CourseModule
): Course {
  return mapModules(course, levelId, (modules) =>
    modules.map((mod) => (mod.id === moduleId ? update(mod) : mod))
  )
}

export function courseReducer(course: Course, action: CourseAction): Course {
  switch (action.type) {
    case "addModule":
      return mapModules(course, action.levelId, (modules) => [...modules, action.module])

    case "updateModule":
      return mapModule(course, action.levelId, action.moduleId, (mod) => ({ ...mod, ...action.patch }))

    case "removeModule":
      return mapModules(course, action.levelId, (modules) => modules.filter((m) => m.id !== action.moduleId))

    case "moveModule":
      return mapModules(course, action.levelId, (modules) => move(modules, action.moduleId, action.offset))

    case "addLesson":
      return mapModule(course, action.levelId, action.moduleId, (mod) => ({
        ...mod,
        lessons: [...mod.lessons, action.lesson],
      }))

    case "renameLesson":
      return mapModule(course, action.levelId, action.moduleId, (mod) => ({
        ...mod,
        lessons: mod.lessons.map((l) => (l.id === action.lessonId ? { ...l, title: action.title } : l)),
      }))

    case "removeLesson":
      return mapModule(course, action.levelId, action.moduleId, (mod) => ({
        ...mod,
        lessons: mod.lessons.filter((l) => l.id !== action.lessonId),
      }))

    case "moveLesson":
      return mapModule(course, action.levelId, action.moduleId, (mod) => ({
        ...mod,
        lessons: move(mod.lessons, action.lessonId, action.offset),
      }))
  }
}
