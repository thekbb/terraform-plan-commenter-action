import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface PlanCore {
  setOutput(name: string, value: string | number): void;
  setFailed(message: string): void;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Both streams write to the same file descriptor. Each write completes before
// another chunk is accepted, and the log callback provides backpressure.
const captureOutput = (descriptor: number): Writable => new Writable({
  write(chunk: Buffer, _encoding, callback) {
    try {
      fs.writeFileSync(descriptor, chunk);
      process.stdout.write(chunk, callback);
    } catch (error) {
      callback(new Error(errorMessage(error)));
    }
  },
});

const executePlan = async (
  cwd: string,
  env: NodeJS.ProcessEnv,
  descriptor: number
): Promise<0 | 1 | 2> => {
  const child = spawn('terraform', ['plan', '-no-color', '-input=false', '-detailed-exitcode'], {
    cwd,
    env,
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const completion = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      if (signal) {
        reject(new Error(`Terraform plan terminated by signal ${signal}`));
      } else {
        resolve(code);
      }
    });
  });

  let terminationTimer: NodeJS.Timeout | undefined;
  const stopOnCaptureFailure = (error: unknown): never => {
    child.kill();
    // Give Terraform time to release its state lock, then ensure failed capture
    // cannot leave the action waiting indefinitely for a child that ignores TERM.
    terminationTimer ??= setTimeout(() => child.kill('SIGKILL'), 5000).unref();
    throw error;
  };

  try {
    // Observe every result and drain both streams before closing the file or
    // publishing outputs. A successful Terraform exit cannot mask capture errors.
    const [stdout, stderr, result] = await Promise.allSettled([
      pipeline(child.stdout, captureOutput(descriptor)).catch(stopOnCaptureFailure),
      pipeline(child.stderr, captureOutput(descriptor)).catch(stopOnCaptureFailure),
      completion,
    ]);
    for (const capture of [stdout, stderr]) {
      if (capture.status === 'rejected') {
        throw new Error(`Could not capture Terraform plan output: ${errorMessage(capture.reason)}`);
      }
    }
    if (result.status === 'rejected') {
      throw new Error(`Could not run Terraform plan: ${errorMessage(result.reason)}`);
    }
    const exitcode = result.value;
    if (exitcode !== 0 && exitcode !== 1 && exitcode !== 2) {
      throw new Error(`Unexpected Terraform plan exit status ${String(exitcode)}`);
    }
    return exitcode;
  } finally {
    clearTimeout(terminationTimer);
  }
};

export default async function runTerraformPlan({ core }: { core: PlanCore }): Promise<void> {
  const env = { ...process.env };
  const cwd = env.WORKING_DIR === '' ? '.' : (env.WORKING_DIR ?? '.');
  const temporaryDirectory = env.RUNNER_TEMP === '' ? os.tmpdir() : (env.RUNNER_TEMP ?? os.tmpdir());
  let outputPath: string | undefined;
  let handedOff = false;

  try {
    const candidatePath = path.join(temporaryDirectory, `terraform-plan-comment.${randomUUID()}`);
    const descriptor = fs.openSync(candidatePath, 'wx', 0o600);
    outputPath = candidatePath;
    let workspace: string;
    let exitcode: 0 | 1 | 2;
    try {
      const result = await execFileAsync('terraform', ['workspace', 'show'], { cwd, env, shell: false });
      workspace = result.stdout.trim();
      if (!workspace || /[\r\n]/u.test(workspace)) {
        throw new Error('Terraform returned an empty or multiline workspace name');
      }
      exitcode = await executePlan(cwd, env, descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    // Terraform exit 1 still reaches the failure comment. The composite action
    // fails afterward. No result is published for runner or capture failures.
    core.setOutput('workspace', workspace);
    core.setOutput('stdout_path', outputPath);
    core.setOutput('exitcode', exitcode);
    handedOff = true;
  } catch (error) {
    core.setFailed(`Terraform plan runner failed: ${errorMessage(error)}`);
  } finally {
    if (outputPath && !handedOff) {
      fs.rmSync(outputPath, { force: true });
    }
  }
}
