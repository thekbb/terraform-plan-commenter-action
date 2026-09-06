import { parseSetupTerraform, parseSummaryTheme } from './config.js';

export interface ValidationCore {
  setOutput(name: string, value: string): void;
  setFailed(message: string): void;
}

export default function validateInputs({ core }: { core: ValidationCore }): void {
  const { SETUP_TERRAFORM, SUMMARY_THEME } = process.env;
  try {
    const setupTerraform = parseSetupTerraform(SETUP_TERRAFORM);
    const summaryTheme = parseSummaryTheme(SUMMARY_THEME);
    // Publish only after every input is valid. Later steps use these values.
    core.setOutput('setup-terraform', setupTerraform);
    core.setOutput('summary-theme', summaryTheme);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : 'Input validation failed.');
  }
}
