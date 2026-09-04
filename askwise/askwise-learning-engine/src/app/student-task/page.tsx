import { revalidatePath } from "next/cache";

import { createTask, getPilotContext } from "@/lib/db";
import CompanionTaskForm from "@/components/task-flow/companion-task-form";
import CardShell from "@/components/ui/card-shell";
import AskwiseButton from "@/components/ui/button";
import ConfidenceSelector from "@/components/task-flow/confidence-selector";

export default function StudentTaskPage({
  searchParams,
}: {
  searchParams?: { subject?: string; topic?: string };
}) {
  const { studentId } = getPilotContext();
  async function createTaskAction(formData: FormData) {
    "use server";
    const subject = String(formData.get("subject") || "Mathematics");
    const topic = String(formData.get("topic") || "line intersects ellipse with Vieta");
    const question = String(formData.get("question") || "");
    const confidence = String(formData.get("confidence") || "I know how to solve it");
    const initialAttempt = String(formData.get("initialAttempt") || "");

    const result = createTask({
      subject,
      topic,
      question,
      confidence,
      initialAttempt,
    });

    revalidatePath("/");
    revalidatePath("/student-task");
    return { redirectTo: `/task/${result.taskId}` };
  }

  return (
    <div className="grid">
      <h1>Student Task</h1>
      <CardShell
        title="Create Initial Attempt"
        description="Do not paste full answers. Keep concise and directional."
      >
        <CompanionTaskForm action={createTaskAction} scopeKey={`askwise:student:${studentId}`}
          sourceEvent={{ state: "WELCOME", eventId: "student-task:ready" }}>
          <label htmlFor="subject">Subject</label>
          <select id="subject" name="subject">
            <option value="Politics">Politics</option>
            <option value="Mathematics">Mathematics</option>
          </select>

          <label htmlFor="topic">Topic</label>
          <input id="topic" name="topic" defaultValue={searchParams?.topic ?? ""} />

          <label htmlFor="question">Question</label>
          <textarea id="question" name="question" rows={3} placeholder="Paste or write the problem statement" />

          <label htmlFor="initialAttempt">Student Initial Attempt</label>
          <textarea
            id="initialAttempt"
            name="initialAttempt"
            rows={4}
            placeholder="Do not give the full answer yet."
            required
          />

          <ConfidenceSelector required />

          <AskwiseButton type="submit" variant="primary">
            Start Task
          </AskwiseButton>
        </CompanionTaskForm>
      </CardShell>
    </div>
  );
}
