import { expect, it } from 'vitest'
import { batchPollInterval, type ImportRow } from './api'

function batch(
  job_status: string,
  steps: [string, string, string] = ['succeeded', 'succeeded', 'succeeded'],
) {
  return {
    id: 'batch',
    source: 'photos',
    parent_job_id: 'job',
    job_status,
    job_error: null,
    rows: [
      {
        conversion_status: steps[0],
        analysis_status: steps[1],
        cutout_status: steps[2],
      } as ImportRow,
    ],
  }
}

it('stops polling when all work is terminal, including errors and unrequested steps', () => {
  expect(batchPollInterval(undefined)).toBe(false)
  for (const status of ['succeeded', 'failed', 'interrupted', 'cancelled']) {
    expect(batchPollInterval(batch(status, [status, status, 'not_requested']))).toBe(false)
  }
})

it('keeps polling the parent until completion, even before rows exist', () => {
  for (const status of ['queued', 'running', 'cancel_requested']) {
    expect(batchPollInterval({ ...batch(status), rows: [] })).toBe(2000)
  }
})

it('resumes for each independently retried step after the parent completes, then stops', () => {
  for (const parent of ['succeeded', 'failed', 'interrupted', 'cancelled']) {
    for (const index of [0, 1, 2]) {
      for (const status of ['queued', 'running']) {
        const steps: [string, string, string] = ['succeeded', 'succeeded', 'succeeded']
        steps[index] = status
        expect(batchPollInterval(batch(parent, steps))).toBe(2000)
        steps[index] = 'succeeded'
        expect(batchPollInterval(batch(parent, steps))).toBe(false)
      }
    }
  }
})
