import Link from "next/link";
import { revalidatePath } from "next/cache";

import {
  addAttempt,
  buildEvidenceForSession,
  closeSession,
  getAttemptsForSession,
  getEvidenceForTask,
  getLatestHintLevel,
  getSessionByTask,
  getSessionSnapshot,
  getTaskById,
  saveDiagnosis,
  saveHint,
} from "@/lib/db";
import { buildProfileFromAttempts } from "@/lib/engine/learning";
import { diagnose } from "@/lib/engine/diagnosis";
import { chooseLearningMode } from "@/lib/engine/learning-mode";
import { buildHint, nextHintLevel } from "@/lib/engine/hint-policy";
import { SessionLogger, createSessionLogEntry } from "@/lib/engine/session";
import type { Subject } from "@/lib/engine/engine-types";
import type { Attempt } from "@/lib/types";

import AoyuCompanion from "@/components/aoyu/aoyu-companion";
import CompanionTaskForm from "@/components/task-flow/companion-task-form";
import { taskCompanionEvent } from "@/lib/aoyu-task-adapter";
import CardShell from "@/components/ui/card-shell";
import AskwiseButton from "@/components/ui/button";
import AttemptHistory from "@/components/task-flow/attempt-history";

type FlowState = "initial" | "diagnosis" | "hint-retry" | "solved";

type DiagnosisType = "Knowledge Gap" | "Recognition Gap" | "Strategy Gap" | "Execution Gap" | "Solved";

function mapDiagnosisType(
  subject: Subject,
  topic: string,
  mode: string,
  diagnosis: ReturnType<typeof diagnose>
): DiagnosisType {
  if (diagnosis.errorType === null) return "Solved";
  if (diagnosis.executionError) return "Execution Gap";
  if (mode === "Thinking Mode" || diagnosis.errorType === "K4" || diagnosis.errorType === "P4") return "Strategy Gap";
  if (diagnosis.errorType === "K2" || diagnosis.errorType === "P5") return "Recognition Gap";
  return mode === "Teaching Mode" || mode === "Recall Mode" ? "Knowledge Gap" : "Knowledge Gap";
}

function getFlowState(solved: boolean, attempts: Array<unknown>, hasDiagnosis: boolean, hasHint: boolean): FlowState {
  if (solved) return "solved";
  if (attempts.length === 0 || !hasDiagnosis) return "initial";
  if (hasDiagnosis && !hasHint) return "diagnosis";
  if (hasDiagnosis && hasHint) return "hint-retry";
  return "initial";
}

export default function TaskPage({ params }: { params: { taskId: string } }) {
  const taskId = Number(params.taskId);
  const fetchedTask = getTaskById(taskId) as
    | {
        id: number;
        student_id: number;
        subject: Subject;
        topic: string;
        question: string;
        status: string;
      }
    | undefined;
  if (!fetchedTask) {
    return <div className="askwise-card">Task not found.</div>;
  }
  const task = fetchedTask;

  const taskSession = getSessionByTask(task.id);
  if (!taskSession) {
    return <div className="askwise-card">Learning session unavailable.</div>;
  }

  const snapshot = getSessionSnapshot(taskSession.id);
  const attempts = (snapshot?.attempts ?? []) as Attempt[];
  const latestHint = snapshot?.latestHint;
  const latestDiagnosis = snapshot?.diagnosis;
  const solved = taskSession.solved === 1;

  const evidence = getEvidenceForTask(task.id) as
    | {
        final_result: string;
        independence: string;
        hint_count: number;
        retry_count: number;
        hint_level: number;
      }
    | undefined;

  const flowState = getFlowState(solved, attempts, Boolean(latestDiagnosis), Boolean(latestHint));

  const companionEvent = taskCompanionEvent({
    taskId: task.id, sessionId: taskSession.id, solved,
    evidenceConfirmed: Boolean(evidence), hintLevel: latestHint?.hint_level ?? 0,
    attemptCount: attempts.length,
  });
  const companionScope = `askwise:student:${task.student_id}`;

  async function submitAttempt(formData: FormData) {
    "use server";

    const rawAttempt = String(formData.get("studentAttempt") || "").trim();
    if (!rawAttempt) {
      revalidatePath(`/task/${taskId}`);
      return;
    }

    const currentSession = getSessionByTask(task.id);
    if (!currentSession) {
      throw new Error("Learning session unavailable");
    }

    const history = getAttemptsForSession(currentSession.id) as Array<Attempt>;
    const profile = buildProfileFromAttempts(
      task.subject,
      task.topic,
      history.map((item) => ({ isCorrect: Boolean(item.is_correct) }))
    );
    const diagnosis = diagnose(task.subject, task.topic, rawAttempt);
    const modeDecision = chooseLearningMode(profile, task.subject, task.topic, diagnosis);
    const currentHint = getLatestHintLevel(currentSession.id);
    const firstStepMs = Number(formData.get("firstStepMs") || "0");
    const isCorrect = diagnosis.errorType === null;
    const firstStepTime = history.length === 0 && firstStepMs > 0 ? Date.now() - firstStepMs : undefined;

    addAttempt(currentSession.id, rawAttempt, currentHint, isCorrect);
    saveDiagnosis(currentSession.id, mapDiagnosisType(task.subject, task.topic, modeDecision.mode, diagnosis), diagnosis.explanation, 0.8);

    if (!isCorrect) {
      const nextHint = nextHintLevel(currentHint, false);
      const hint = buildHint(task.subject, task.topic, nextHint, modeDecision.mode);
      saveHint(currentSession.id, nextHint, hint, false);

      const logger = new SessionLogger();
      logger.append(
        createSessionLogEntry({
          subject: task.subject,
          topic: task.topic,
          studentInput: rawAttempt,
          diagnosis: diagnosis.explanation,
          errorType: diagnosis.errorType ?? "UNKNOWN",
          learningMode: modeDecision.mode,
          hintLevel: nextHint,
          firstStepTime,
          outcome: "incorrect",
        })
      );
      revalidatePath(`/task/${task.id}`);
      return;
    }

    const finalResult = currentHint === 0 ? "Solved Independently" : `Solved With Hint ${currentHint}`;
    closeSession(currentSession.id, finalResult, currentHint === 0);
    buildEvidenceForSession(currentSession.id, finalResult);

    const logger = new SessionLogger();
    logger.append(
      createSessionLogEntry({
        subject: task.subject,
        topic: task.topic,
        studentInput: rawAttempt,
        diagnosis: diagnosis.explanation,
        errorType: "OK",
        learningMode: modeDecision.mode,
        hintLevel: currentHint,
        firstStepTime,
        outcome: "correct",
      })
    );

    revalidatePath(`/task/${task.id}`);
    revalidatePath("/evidence");
  }

  return (
    <div className="grid">
      <h1>Learning Flow</h1>
      <CardShell title="Task" description={`Flow State: ${flowState}`}>
        <div className="task-header">
          <p>
            <strong>Subject:</strong> {task.subject}
          </p>
          <p>
            <strong>Topic:</strong> {task.topic}
          </p>
          <p>
            <strong>Question:</strong> {task.question || "Awaiting historical data"}
          </p>
          <p>
            <strong>Status:</strong>{" "}
            <span className={solved ? "status-good" : "status-bad"}>
              {solved ? "Solved" : "In Progress"}
            </span>
          </p>
        </div>
      </CardShell>

      {solved && <AoyuCompanion aoyuState={companionEvent.state}
        eventKey={companionEvent.eventId} completionKey={companionEvent.completionKey}
        scopeKey={companionScope} soundEnabled={false} />}

      <CardShell
        title="Learning Metrics"
        description="Track hint + retry progress for this task."
      >
        <div className="row">
          <span className="status-chip good">Attempts: {attempts.length}</span>
          <span className="status-chip warn">Hint Count: {taskSession.hint_count}</span>
          <span className="status-chip warn">Retry Count: {taskSession.retry_count}</span>
          <span className="status-chip good">Hint Level: {getLatestHintLevel(taskSession.id)}</span>
        </div>
      </CardShell>

      {!solved ? (
        <CardShell
          title={flowState === "initial" ? "Initial Attempt" : "Retry Attempt"}
          description={flowState === "initial" ? "First step is diagnostic, not answer-dictating." : "Use one concise retry."}
        >
          <CompanionTaskForm action={submitAttempt} scopeKey={companionScope}
            sourceEvent={companionEvent} retry={attempts.length > 0}>
            <label htmlFor="studentAttempt">
              {flowState === "initial" ? "Initial Attempt" : "Retry Attempt"}
            </label>
            <textarea
              id="studentAttempt"
              name="studentAttempt"
              rows={4}
              required
              placeholder="Write your next reasoning step."
            />
            <input type="hidden" name="taskId" value={task.id} />
            <input type="hidden" name="firstStepMs" value={Date.now()} />
            <AskwiseButton type="submit" variant="primary">
              Submit
            </AskwiseButton>
          </CompanionTaskForm>
        </CardShell>
      ) : null}

      {!solved ? (
        <>
          <CardShell title="Diagnosis" description="Diagnose first, then guide the next step">
            {latestDiagnosis ? (
              <div>
                <p>{latestDiagnosis.type}</p>
                <p>{latestDiagnosis.reason}</p>
              </div>
            ) : (
              <p className="muted">No diagnosis yet. Submit your attempt first.</p>
            )}
          </CardShell>

          <CardShell title="Hint + Retry" description="Minimum necessary hint for the current step">
            {latestHint?.content ? (
              <div>
                <p>
                  <strong>Hint Level {latestHint.hint_level}</strong>
                </p>
                <p>{latestHint.content}</p>
              </div>
            ) : (
              <p className="muted">No hint yet.</p>
            )}
          </CardShell>
        </>
      ) : null}

      <CardShell title="Attempt Timeline" description="Actual student interaction records (not chat log)">
        <AttemptHistory attempts={attempts} />
      </CardShell>

      {solved ? (
        <CardShell
          title="Solved & Learning Evidence"
          description="Proceed to Evidence and close the cycle with map + reflection."
        >
          <p className="status-good">Solved. Keep the reflection and evidence consistency.</p>
          <p>
            <strong>Final Result:</strong> {taskSession.final_result}
          </p>
          <p>
            <strong>Independence:</strong> {taskSession.independent ? "Independent" : "Assisted"}
          </p>
          <div className="row">
            <Link className="button button-secondary" href="/evidence">
              Open Learning Evidence
            </Link>
            <Link className="button button-secondary" href="/maps/political">
              Update Knowledge Map
            </Link>
            <Link className="button button-secondary" href="/reflection">
              Daily Reflection
            </Link>
          </div>
          {evidence ? (
            <div className="evidence-list" style={{ marginTop: "10px" }}>
              <article className="timeline-item">
                <p>
                  <strong>Evidence Key:</strong> {evidence.final_result}
                </p>
                <p>Hint Level {evidence.hint_level}</p>
                <p>Retries {evidence.retry_count}, Hints {evidence.hint_count}</p>
              </article>
            </div>
          ) : null}
        </CardShell>
      ) : null}
    </div>
  );
}
