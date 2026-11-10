import type { Metadata } from 'next';
import { lessonBySlug } from '@/lib/course/govcon-roadmap';
import CoursePlayer from './CoursePlayer';
import { LessonBody, lessonTitle } from './lessons';

export const revalidate = 3600;

const DESCRIPTION =
  'A free, step-by-step course for winning government contracts: find your stage, learn what to do next, and get a personalized GovCon roadmap.';

export const metadata: Metadata = {
  title: 'The Federal Contracting Roadmap — Free Course | Mindy',
  description: DESCRIPTION,
  alternates: { canonical: 'https://getmindy.ai/course' },
  openGraph: { title: 'The Federal Contracting Roadmap', description: DESCRIPTION, url: 'https://getmindy.ai/course', siteName: 'Mindy', type: 'website' },
};

export default function CourseStartPage() {
  const lesson = lessonBySlug('start-here')!;
  return (
    <CoursePlayer lesson={lesson} title={lessonTitle(lesson)}>
      <LessonBody lesson={lesson} />
    </CoursePlayer>
  );
}
