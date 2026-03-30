# AGENT.md — worker

## Overview

GPU job coordinator. Consumes BullMQ jobs from the backend, submits them to RunPod serverless endpoints, and reports progress back.

## Stack

- **Runtime:** Node.js, TypeScript
- **Queue:** BullMQ + Express
- **GPU provider:** RunPod (via runpod-sdk)
- **HTTP:** Axios
- **Admin UI:** Bull Board (Express-based dashboard)
- **Package manager:** pnpm (or npm)

## Project Structure

```
src/
  workers/       # BullMQ worker processors per job type
  services/      # Business logic (status handling, RunPod submission)
  config/        # Configuration and environment
  shared/        # Shared types/utilities
  utils/         # Helper functions
```

## Commands

```bash
npm run dev      # Watch mode with nodemon
npm run build    # Compile TypeScript
npm run start    # Production start
npm run test     # Run tests
```

Bull Dashboard: http://localhost:3000/admin (user: admin)

## Key Patterns

- Each GPU algorithm (Deforum, AnimateDiff, Wan, Uprez, Qwen) has a dedicated RunPod endpoint
- Workers consume from BullMQ queues and submit to RunPod
- Status/progress updates are reported back to the backend via API calls
- Preview frames are captured and stored in Redis during rendering

## Deployment

Heroku — manual deployment.
