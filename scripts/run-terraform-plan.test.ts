import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import runTerraformPlan, { type PlanCore } from '../src/run-terraform-plan.js';

describe('Terraform plan runner', () => {
  let root: string;
  let bin: string;
  let runnerTemp: string;
  let callsFile: string;
  let logs: string[];
  let core: {
    setOutput: ReturnType<typeof vi.fn<PlanCore['setOutput']>>;
    setFailed: ReturnType<typeof vi.fn<PlanCore['setFailed']>>;
  };

  const run = async (env: Record<string, string> = {}): Promise<void> => {
    for (const [name, value] of Object.entries(env)) {
      vi.stubEnv(name, value);
    }
    await runTerraformPlan({ core });
  };

  const expectNoResult = (): void => {
    expect(core.setFailed).toHaveBeenCalledOnce();
    expect(core.setOutput).not.toHaveBeenCalled();
    expect(fs.readdirSync(runnerTemp)).toEqual([]);
  };

  const outputPath = (): string => {
    const value = core.setOutput.mock.calls.find(([name]) => name === 'stdout_path')?.[1];
    expect(value).toBeTypeOf('string');
    return String(value);
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'terraform runner test '));
    bin = path.join(root, 'fake bin');
    runnerTemp = path.join(root, 'runner temp');
    callsFile = path.join(root, 'terraform calls');
    fs.mkdirSync(bin);
    fs.mkdirSync(runnerTemp);
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    core = {
      setOutput: vi.fn<PlanCore['setOutput']>(),
      setFailed: vi.fn<PlanCore['setFailed']>(),
    };
    logs = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void
    ): boolean => {
      logs.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      done?.();
      return true;
    });
    const env = {
      PATH: bin,
      WORKING_DIR: root,
      RUNNER_TEMP: runnerTemp,
      TEST_CALLS: callsFile,
      FAKE_PLAN_EXIT: '0',
      FAKE_WORKSPACE_EXIT: '0',
      FAKE_WORKSPACE: 'test-workspace',
      FAKE_SIGNAL: '',
      FAKE_REMOVE_EXECUTABLE: '',
      FAKE_OUTPUT_SIZE: '0',
      TF_CLI_ARGS_plan: '',
    };
    for (const [name, value] of Object.entries(env)) {
      vi.stubEnv(name, value);
    }
    fs.writeFileSync(path.join(bin, 'terraform'), `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'workspace') {
  process.stdout.write(process.env.FAKE_WORKSPACE + '\\n');
  if (process.env.FAKE_REMOVE_EXECUTABLE) fs.unlinkSync(process.argv[1]);
  process.exitCode = Number(process.env.FAKE_WORKSPACE_EXIT);
} else if (args[0] === 'plan') {
  fs.writeFileSync(process.env.TEST_CALLS, JSON.stringify({
    args, planArgs: process.env.TF_CLI_ARGS_plan, cwd: process.cwd()
  }));
  process.stdout.write('plan stdout\\n' + 'x'.repeat(Number(process.env.FAKE_OUTPUT_SIZE)));
  process.stderr.write('plan stderr\\n');
  if (process.env.FAKE_SIGNAL) process.kill(process.pid, process.env.FAKE_SIGNAL);
  process.exitCode = Number(process.env.FAKE_PLAN_EXIT);
} else {
  process.exitCode = 99;
}
`, { mode: 0o755 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it.each([0, 1, 2])('hands off a complete result for Terraform exit %i', async (exitcode) => {
    await run({ FAKE_PLAN_EXIT: String(exitcode) });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.setOutput).toHaveBeenCalledTimes(3);
    expect(core.setOutput).toHaveBeenCalledWith('workspace', 'test-workspace');
    expect(core.setOutput).toHaveBeenCalledWith('exitcode', exitcode);
    expect(path.dirname(outputPath())).toBe(runnerTemp);
    const output = fs.readFileSync(outputPath(), 'utf8');
    expect(output).toContain('plan stdout\n');
    expect(output).toContain('plan stderr\n');
    expect(logs.join('')).toBe(output);
    expect(fs.readdirSync(runnerTemp)).toHaveLength(1);
  });

  it.each([3, 127, 130])('fails and cleans up for unexpected Terraform exit %i', async (exitcode) => {
    await run({ FAKE_PLAN_EXIT: String(exitcode) });

    expectNoResult();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining(`Unexpected Terraform plan exit status ${String(exitcode)}`));
    expect(logs.join('')).toContain('plan stdout\n');
    expect(logs.join('')).toContain('plan stderr\n');
  });

  it('reports signal termination as failure', async () => {
    await run({ FAKE_SIGNAL: 'SIGTERM' });

    expectNoResult();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('terminated by signal SIGTERM'));
  });

  it.each([1, 127])('stops before planning when workspace detection exits %i', async (exitcode) => {
    await run({ FAKE_WORKSPACE_EXIT: String(exitcode) });

    expectNoResult();
    expect(fs.existsSync(callsFile)).toBe(false);
  });

  it.each(['', 'first\nsecond'])('rejects an invalid workspace name %j', async (workspace) => {
    await run({ FAKE_WORKSPACE: workspace });

    expectNoResult();
    expect(fs.existsSync(callsFile)).toBe(false);
  });

  it('reports failure to start the workspace command', async () => {
    fs.unlinkSync(path.join(bin, 'terraform'));
    // Use an empty search path so an installed Terraform cannot satisfy the test.
    await run({ PATH: bin });

    expectNoResult();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('reports failure to start the plan command', async () => {
    await run({ FAKE_REMOVE_EXECUTABLE: 'true' });

    expectNoResult();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('ENOENT'));
  });

  it('stops when the temporary file cannot be created', async () => {
    await run({ RUNNER_TEMP: path.join(runnerTemp, 'missing directory') });

    expectNoResult();
    expect(fs.existsSync(callsFile)).toBe(false);
  });

  it.each([0, 1, 2])('rejects failed capture even when Terraform would exit %i', async (exitcode) => {
    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('simulated disk full');
    });
    await run({ FAKE_PLAN_EXIT: String(exitcode) });

    expectNoResult();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Could not capture Terraform plan output'));
  });

  it('cleans up when publishing step outputs fails', async () => {
    core.setOutput.mockImplementation(() => {
      throw new Error('output destination is not writable');
    });
    await run();

    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('output destination is not writable'));
    expect(fs.readdirSync(runnerTemp)).toEqual([]);
  });

  it('captures output larger than the execFile default buffer', async () => {
    const size = 2 * 1024 * 1024;
    await run({ FAKE_OUTPUT_SIZE: String(size) });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(fs.statSync(outputPath()).size).toBe(size + Buffer.byteLength('plan stdout\nplan stderr\n'));
  });

  it('keeps trusted plan arguments in the environment without shell evaluation', async () => {
    const marker = path.join(root, 'must not exist');
    const planArgs = `-var='value=$(touch "${marker}")' -var-file='vars with spaces.tfvars'`;
    await run({ TF_CLI_ARGS_plan: planArgs });

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(fs.readFileSync(callsFile, 'utf8')).toBe(JSON.stringify({
      args: ['plan', '-no-color', '-input=false', '-detailed-exitcode'],
      planArgs,
      cwd: fs.realpathSync(root),
    }));
    expect(fs.existsSync(marker)).toBe(false);
  });
});
