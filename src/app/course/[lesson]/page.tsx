import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { COURSE_LESSONS, lessonBySlug } from '@/lib/course/govcon-roadmap';
import CoursePlayer from '../CoursePlayer';
import { LessonBody, lessonTitle } from '../lessons';

export const revalidate = 3600;
export const dynamicParams = false;

export function generateStaticParams() {
  return COURSE_LESSONS.filter((l) => l.slug !== 'start-here').map((l) => ({ lesson: l.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ lesson: string }> }): Promise<Metadata> {
  const { lesson: slug } = await params;
  const lesson = lessonBySlug(slug);
  if (!lesson) return {};
  const title = lessonTitle(lesson);
  const url = `https://getmindy.ai/course/${lesson.slug}`;
  const description = lesson.stage?.tagline ?? 'Part of The Federal Contracting Roadmap, a free course from Mindy.';
  return {
    title: `${title} — The Federal Contracting Roadmap | Mindy`,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: 'Mindy', type: 'article' },
  };
}

export default async function CourseLessonPage({ params }: { params: Promise<{ lesson: string }> }) {
  const { lesson: slug } = await params;
  if (slug === 'start-here') redirect('/course');
  const lesson = lessonBySlug(slug);
  if (!lesson) notFound();
  return (
    <CoursePlayer lesson={lesson} title={lessonTitle(lesson)} videoUrl={lesson.stage?.videoUrl}>
      <LessonBody lesson={lesson} />
    </CoursePlayer>
  );
}
