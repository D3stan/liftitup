import { ExerciseForm } from '@/components/exercises/ExerciseForm';

interface EditExercisePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditExercisePage({
  params,
}: EditExercisePageProps) {
  const { id } = await params;
  return <ExerciseForm mode="edit" exerciseId={id} />;
}
