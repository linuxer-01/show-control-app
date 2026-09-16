# Slide Sync Remote

Here's a cleaner, developer-focused prompt that keeps your requirements while making it easier for an AI or developer to implement.

Writing

Build a working MVP of a remote PowerPoint control system where the presenter uploads PowerPoint files only from a desktop, and participants use their mobile phones as remote controllers. The priority is functionality, speed, and reliability—not UI.

The desktop acts as the operator/presenter panel. The operator can upload multiple PowerPoint files and generate a unique access code for each presentation. When the operator starts presenting a specific PowerPoint in fullscreen mode, they can enable remote control for that presentation.

Participants open a separate webpage on their mobile phone and join by entering the presentation code. Once approved for the active presentation, their phone becomes a remote controller that can move the PowerPoint slides forward and backward. Slide changes must happen only after the desktop successfully completes the previous slide transition, preventing duplicate or overlapping commands.

The mobile remote should stay awake during use (prevent screen sleep if possible through browser APIs), support touch-only controls, and include a screen lock mode where accidental touches are ignored. After unlocking, the participant can continue navigating forward and backward.

Only participants connected to the currently active fullscreen presentation should have control. Other uploaded PowerPoint files should not be controllable until the operator switches to them and grants remote access. The desktop remains the authority for all slide changes.

Focus entirely on making the core remote-control workflow work first: desktop upload, presentation code generation, participant joining, real-time communication, fullscreen PowerPoint control, command synchronization, and mobile lock/unlock behavior. Ignore UI polish until the complete functionality is working.

This prompt is optimized for building the MVP first without spending tokens on visual design.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://show-control-app.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8b88aef3-99b5-4f11-aa94-5c873b668e36).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
