# AGENTS.md — worker

## Overview

Node.js worker service managing distributed job processing via BullMQ queues. Handles AI generation tasks (video, image, upscaling, animation) and integrates with RunPod serverless endpoints.

## Stack

- **Language:** TypeScript
- **Runtime:** Node.js 22.x
- **Framework:** Express.js (for Bull Board UI)
- **Job Queue:** BullMQ (Redis-backed)
- **Dependencies:** bullmq, express, @aws-sdk/client-s3, runpod-sdk, commander, axios
- **Dev Tools:** Husky, ESLint, Prettier, Nodemon
- **Package Manager:** npm

## Project Structure

```
src/
  index.ts                          # Main application entry point
  config/
    runpod.config.ts                # RunPod endpoint configuration
  shared/
    env.ts                          # Environment variable management
    redis.ts                        # Redis client setup
  workers/
    worker.factory.ts               # Factory pattern for worker creation
    job-handlers.ts                 # Job handlers (video, image, uprez, etc.)
    marketing-email.worker.ts       # Email campaign worker
  services/
    cli.service.ts                  # CLI service
    status-handler.service.ts       # Job status tracking
    video-service.client.ts         # Video service client
    public-endpoint.service.ts      # Public endpoint service
    r2-upload.service.ts            # R2 upload service
    runpod-cancel.service.ts        # RunPod job cancellation
  marketing-cli.ts                  # CLI for marketing tasks
  marketing-worker.ts               # Standalone marketing worker
```

## Commands

```bash
npm install               # Install dependencies
npm run build             # Compile TypeScript
npm start                 # Run compiled worker
npm run dev               # Development mode (watch + nodemon)
npm run lint              # Run ESLint
npm test                  # Run tests
npm run marketing:send    # CLI for sending marketing emails
npm run marketing:worker  # Run marketing worker
```

## Key Patterns

- BullMQ queue-based job processing with multiple job types
- Factory pattern for worker instantiation
- Express API serving Bull Board (queue monitoring dashboard)
- Basic auth protection on monitoring UI
- Environment-based configuration (dev, stage, prod)
- Environment variables: BACKEND*URL, API_KEY, RUNPOD_API_KEY, AWS*\* credentials

## Deployment

Heroku — manual deploy. Bull Dashboard at `/admin` (user: admin).
