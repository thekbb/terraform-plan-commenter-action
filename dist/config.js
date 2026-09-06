import { isSummaryTheme } from './helpers.js';
export const parseSetupTerraform = (value) => {
    if (value === undefined || value === '')
        return 'true';
    if (value === 'true' || value === 'false')
        return value;
    throw new Error('Invalid setup-terraform input: expected true or false.');
};
export const parseSummaryTheme = (value) => {
    if (value === undefined || value === '')
        return 'default';
    if (isSummaryTheme(value))
        return value;
    throw new Error('Invalid summary-theme input: expected default, colorblind, or minimal.');
};
export const parsePlanExitCode = (value) => {
    if (value === '0' || value === '1' || value === '2')
        return value;
    throw new Error('Missing or invalid PLAN_EXIT_CODE: expected 0, 1, or 2 from the Terraform plan step.');
};
