import { expect, test } from 'vitest'
import { PACKAGE_NAME } from '../src/index.js'

test('workspace test harness runs', () => {
  expect(PACKAGE_NAME).toBe('@job-finder/db')
})
