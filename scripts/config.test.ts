import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePlanExitCode, parseSetupTerraform, parseSummaryTheme } from '../src/config.js';
import validateInputs, { type ValidationCore } from '../src/validate-inputs.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('action input parsing', () => {
  it.each([undefined, ''])('defaults omitted or empty optional inputs (%s)', (value) => {
    expect(parseSetupTerraform(value)).toBe('true');
    expect(parseSummaryTheme(value)).toBe('default');
  });

  it.each(['true', 'false'])('accepts setup-terraform=%s', (value) => {
    expect(parseSetupTerraform(value)).toBe(value);
  });

  it.each(['flase', 'yes', 'TRUE', ' false '])('rejects malformed setup-terraform=%s', (value) => {
    expect(() => parseSetupTerraform(value)).toThrow('Invalid setup-terraform input: expected true or false.');
  });

  it.each(['default', 'colorblind', 'minimal'])('accepts summary-theme=%s', (value) => {
    expect(parseSummaryTheme(value)).toBe(value);
  });

  it.each(['colourblind', 'MINIMAL', ' minimal ', 'toString'])('rejects malformed summary-theme=%s', (value) => {
    expect(() => parseSummaryTheme(value)).toThrow('Invalid summary-theme input: expected default, colorblind, or minimal.');
  });

  it.each(['0', '1', '2'])('accepts recorded Terraform exit code %s', (value) => {
    expect(parsePlanExitCode(value)).toBe(value);
  });

  it.each([undefined, '', '3', '02', '2\n'])('rejects missing or malformed recorded exit codes (%s)', (value) => {
    expect(() => parsePlanExitCode(value)).toThrow('Missing or invalid PLAN_EXIT_CODE');
  });
});

describe('input validation step', () => {
  it.each([
    { setup: undefined, theme: undefined, expectedSetup: 'true', expectedTheme: 'default' },
    { setup: 'false', theme: 'minimal', expectedSetup: 'false', expectedTheme: 'minimal' },
  ])('publishes validated values ($expectedSetup, $expectedTheme)', ({ setup, theme, expectedSetup, expectedTheme }) => {
    vi.stubEnv('SETUP_TERRAFORM', setup);
    vi.stubEnv('SUMMARY_THEME', theme);
    const setOutput = vi.fn<ValidationCore['setOutput']>();
    const setFailed = vi.fn<ValidationCore['setFailed']>();

    validateInputs({ core: { setOutput, setFailed } });

    expect(setFailed).not.toHaveBeenCalled();
    expect(setOutput).toHaveBeenCalledTimes(2);
    expect(setOutput).toHaveBeenCalledWith('setup-terraform', expectedSetup);
    expect(setOutput).toHaveBeenCalledWith('summary-theme', expectedTheme);
  });

  it.each([
    { setup: 'flase', theme: 'default', input: 'setup-terraform' },
    { setup: 'true', theme: 'colourblind', input: 'summary-theme' },
  ])('fails without publishing outputs for invalid $input', ({ setup, theme, input }) => {
    vi.stubEnv('SETUP_TERRAFORM', setup);
    vi.stubEnv('SUMMARY_THEME', theme);
    const setOutput = vi.fn<ValidationCore['setOutput']>();
    const setFailed = vi.fn<ValidationCore['setFailed']>();

    validateInputs({ core: { setOutput, setFailed } });

    expect(setFailed).toHaveBeenCalledOnce();
    expect(setFailed).toHaveBeenCalledWith(expect.stringContaining(`Invalid ${input} input:`));
    expect(setOutput).not.toHaveBeenCalled();
  });
});
