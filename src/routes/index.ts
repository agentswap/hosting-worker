import { createRouter } from 'h3'

import modelAppHandler from './model-app.ts'

export const router = createRouter()

// Create model app
router.post('/model-app', modelAppHandler)

// Update model app
router.put('/model-app', modelAppHandler)
