require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const socketIo = require('socket.io');
const blueskyService = require('./bluesky');
const agentMeshService = require('./agentMesh');

// Initialize Express app
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Store conversation history
const conversations = [];

// Get BlueSky handle from environment
const blueskyHandle = process.env.BLUESKY_HANDLE || 'Unknown';

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New client connected');
  
  // Send existing conversations to new clients
  socket.emit('history', conversations);
  
  // Send BlueSky handle to client
  socket.emit('handle_update', { handle: blueskyHandle });
  
  // Handle request for BlueSky handle
  socket.on('get_handle', (data, callback) => {
    callback(blueskyHandle);
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Initialize BlueSky monitoring
async function initBlueSkyMonitoring() {
  try {
    console.log('Initializing BlueSky monitoring...');
    console.log(`Monitoring handle: ${blueskyHandle}`);
    
    // Start monitoring posts
    await blueskyService.startMonitoring(async (post) => {
      console.log(`Received post: ${post.id} - ${post.text}`);
      
      // Extract Solace-related question
      const question = blueskyService.extractQuestion(post.text);
      
      if (question) {
        console.log(`Extracted question: ${question}`);
        
        // Create conversation entry
        const conversation = {
          id: post.id,
          postId: post.id,
          postUri: post.uri,
          author: post.author_username,
          question: question,
          timestamp: new Date().toISOString(),
          status: 'processing'
        };
        
        // Add to conversations
        conversations.unshift(conversation); // Add to beginning of array
        
        // Emit to all clients
        io.emit('new_question', conversation);
        
        try {
          // Send to Agent Mesh
          const response = await agentMeshService.askQuestion(question);
          console.log(`Received response from Agent Mesh: ${response}`);
          
          // Update conversation
          conversation.response = response;
          conversation.status = 'completed';
          conversation.completedAt = new Date().toISOString();
          
          // Emit updated conversation
          io.emit('new_response', conversation);
          
			// Convert markdown to Bluesky format
			const blueskyFormattedText = await blueskyService.markdownToBluesky(response);
          // Reply to the post
          await blueskyService.replyToPost(post.uri, blueskyFormattedText);
          console.log(`Replied to post ${post.id}`);
        } catch (error) {
          console.error('Error processing with Agent Mesh:', error);
          conversation.status = 'error';
          conversation.error = error.message;
          io.emit('error', conversation);
        }
      }
    });
    
    console.log('BlueSky monitoring initialized successfully');
  } catch (error) {
    console.error('Error initializing BlueSky monitoring:', error);
  }
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  initBlueSkyMonitoring();
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await blueskyService.stopMonitoring();
  process.exit(0);
});