# Bluesky + Agent Mesh Integration

This Node.js application monitors tweets sent to a specific Bluesky handle, extracts questions, sends them to Agent Mesh for processing, and replies to the original tweets with the responses. It also includes a web UI that displays the questions being asked and the responses that are returned.

## Features

- Monitors tweets in real-time using the Bluesky API
- Extracts questions from tweets
- Sends questions to Agent Mesh for processing
- Replies to tweets with responses from Agent Mesh
- Provides a web UI to monitor questions and responses
- Supports threaded responses for longer answers

## Prerequisites

- Node.js (v14 or higher)
- npm (v6 or higher)
- Two Bluesky Accounts, one to ask questions and one to answer them
- Agent Mesh API access

## Installation

1. Clone this repository or download the source code

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file based on the provided `env.example`:
   ```bash
   cp env.example .env
   ```

4. Configure your environment variables in the `.env` file:
   - Bluesky account credentials
   - Agent Mesh API URL and key
   - Server port (default: 3000)

## Bluesky API Setup

1. Nothing special is required here, simply add your account details to the configuration file

## Agent Mesh API Setup

1. Obtain your Agent Mesh API URL and API key or deploy a your own copy
2. Configure the Agent Mesh API endpoint in your `.env` file

## Usage

1. Start the application:
   ```bash
   npm start
   ```

2. For development with auto-restart:
   ```bash
   npm run dev
   ```

3. Access the web UI at `http://localhost:3000` (or your configured port)

4. Send a tweet mentioning (@[Bluesky Handle]) your configured Bluesky handle with a question you want answering

## How It Works

1. The application uses Bluesky's API to monitor tweets which mention your handle
2. When a tweet is received, it extracts the question
3. The question is sent to Agent Mesh for processing
4. The response from Agent Mesh is used to reply to the original tweet
5. All questions and responses are displayed in the web UI in real-time

## File Structure

- `app.js` - Main application file
- `bluesky.js` - Bluesky API integration
- `agentMesh.js` - Agent Mesh API integration
- `public/` - Web UI files
  - `index.html` - HTML file for the UI
  - `styles.css` - CSS styling
  - `client.js` - Client-side JavaScript

## Customization

- To change the UI appearance, modify the CSS in `public/styles.css`
- To adjust the Agent Mesh API request format, update the request in `agentMesh.js`

## Limitations

- Bluesky API has rate limits
- Bluesky has no easy way to bulk delete posts so cleaning up after a run can be annoying

## Troubleshooting

- Check the console logs for error messages
- Verify your Bluesky API credentials
- Ensure your Agent Mesh API URL and key are correct
- Check that your Bluesky handle is correctly configured

## License

MIT
