// Connect to Socket.io server
const socket = io();

// DOM Elements
const conversationsList = document.getElementById('conversations-list');
const conversationTemplate = document.getElementById('conversation-template');
const totalQuestionsEl = document.getElementById('total-questions');
const totalResponsesEl = document.getElementById('total-responses');
const avgResponseTimeEl = document.getElementById('avg-response-time');
const filterButtons = document.querySelectorAll('.filter-btn');
const blueskyHandleEl = document.getElementById('bluesky-handle');
const dynamicHandleEls = document.querySelectorAll('.dynamic-handle');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');

// State
let conversations = [];
let currentFilter = 'all';
let isConnected = true;

// Initialize
function init() {
    // Request BlueSky handle from server
    socket.emit('get_handle', {}, (handle) => {
        if (handle) {
            updateBlueskyHandle(handle);
        }
    });

    // Set up filter buttons
    filterButtons.forEach(button => {
        button.addEventListener('click', () => {
            const filter = button.getAttribute('data-filter');
            setActiveFilter(filter);
            renderConversations();
        });
    });

    // Listen for connection status
    socket.on('connect', () => {
        setConnectionStatus(true);
    });

    socket.on('disconnect', () => {
        setConnectionStatus(false);
    });

    // Listen for handle update
    socket.on('handle_update', (data) => {
        updateBlueskyHandle(data.handle);
    });

    // Listen for history event
    socket.on('history', (data) => {
        conversations = data;
        renderConversations();
        updateStats();
    });

    // Listen for new questions
    socket.on('new_question', (data) => {
        const existingIndex = conversations.findIndex(c => c.id === data.id);
        if (existingIndex >= 0) {
            conversations[existingIndex] = data;
        } else {
            conversations.unshift(data);
        }
        renderConversations();
        updateStats();
        notifyUser('New question received');
    });

    // Listen for new responses
    socket.on('new_response', (data) => {
        const existingIndex = conversations.findIndex(c => c.id === data.id);
        if (existingIndex >= 0) {
            conversations[existingIndex] = data;
        } else {
            conversations.unshift(data);
        }
        renderConversations();
        updateStats();
        notifyUser('Response received');
    });

    // Listen for errors
    socket.on('error', (data) => {
        const existingIndex = conversations.findIndex(c => c.id === data.id);
        if (existingIndex >= 0) {
            conversations[existingIndex] = data;
        } else {
            conversations.unshift(data);
        }
        renderConversations();
        updateStats();
        notifyUser('Error occurred');
    });
}

// Update BlueSky handle display
function updateBlueskyHandle(handle) {
    if (blueskyHandleEl) {
        blueskyHandleEl.textContent = handle;
    }
    
    dynamicHandleEls.forEach(el => {
        el.textContent = handle;
    });
}

// Set connection status
function setConnectionStatus(connected) {
    isConnected = connected;
    
    if (statusIndicator) {
        statusIndicator.className = `status-indicator ${connected ? 'online' : 'offline'}`;
    }
    
    if (statusText) {
        statusText.textContent = connected ? 'Connected' : 'Disconnected';
    }
}

// Set active filter
function setActiveFilter(filter) {
    currentFilter = filter;
    filterButtons.forEach(button => {
        if (button.getAttribute('data-filter') === filter) {
            button.classList.add('active');
        } else {
            button.classList.remove('active');
        }
    });
}

// Render conversations
function renderConversations() {
    // Clear existing content
    if (!conversationsList) return;
    conversationsList.innerHTML = '';

    // Filter conversations
    const filteredConversations = conversations.filter(conversation => {
        if (currentFilter === 'all') return true;
        return conversation.status === currentFilter;
    });

    // Show empty state if no conversations
    if (filteredConversations.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = `
            <i class="fas fa-comment-dots"></i>
            <p>No ${currentFilter === 'all' ? '' : currentFilter} conversations yet. Waiting for BlueSky mentions...</p>
        `;
        conversationsList.appendChild(emptyState);
        return;
    }

    // Render each conversation
    filteredConversations.forEach(conversation => {
        const card = createConversationCard(conversation);
        conversationsList.appendChild(card);
    });
}

// Create conversation card
function createConversationCard(conversation) {
    const clone = document.importNode(conversationTemplate.content, true);
    const card = clone.querySelector('.conversation-card');
    
    // Set status class
    card.classList.add(conversation.status);
    
    // Set avatar and username
    const avatar = card.querySelector('.avatar');
    avatar.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(conversation.author)}&background=random`;
    
    const username = card.querySelector('.username');
    username.textContent = conversation.author;
    
    // Set timestamp
    const timestamp = card.querySelector('.timestamp');
    timestamp.textContent = formatDate(conversation.timestamp);
    
    // Set status badge
    const statusBadge = card.querySelector('.status-badge');
    statusBadge.textContent = capitalizeFirstLetter(conversation.status);
    statusBadge.classList.add(conversation.status);
    
    // Set question
    const questionEl = card.querySelector('.question');
    questionEl.textContent = conversation.question;
    
    // Set response or error
    const responseEl = card.querySelector('.response');
    const errorEl = card.querySelector('.error-message');
    
    if (conversation.status === 'completed') {
        responseEl.textContent = conversation.response;
        responseEl.style.display = 'block';
        errorEl.style.display = 'none';
    } else if (conversation.status === 'error') {
        errorEl.textContent = conversation.error || 'An error occurred while processing this question.';
        errorEl.style.display = 'block';
        responseEl.style.display = 'none';
    } else {
        responseEl.textContent = 'Processing...';
        responseEl.style.display = 'block';
        errorEl.style.display = 'none';
    }
    
    // Set link to post
    const viewPostLink = card.querySelector('.view-post');
    viewPostLink.href = `https://bsky.app/profile/${conversation.author}/post/${conversation.postId}`;
    viewPostLink.textContent = 'View on BlueSky';
    
    // Set processing time
    const processingTimeEl = card.querySelector('.processing-time');
    if (conversation.status === 'completed' && conversation.timestamp) {
        const startTime = new Date(conversation.timestamp);
        const endTime = new Date(conversation.completedAt || Date.now());
        const processingTime = Math.round((endTime - startTime) / 1000);
        processingTimeEl.textContent = `Processed in ${processingTime}s`;
    } else {
        processingTimeEl.textContent = '';
    }
    
    return card;
}

// Update statistics
function updateStats() {
    // Total questions
    if (totalQuestionsEl) {
        totalQuestionsEl.textContent = conversations.length;
    }
    
    // Total responses
    const completedConversations = conversations.filter(c => c.status === 'completed');
    if (totalResponsesEl) {
        totalResponsesEl.textContent = completedConversations.length;
    }
    
    // Average response time
    if (avgResponseTimeEl && completedConversations.length > 0) {
        let totalTime = 0;
        completedConversations.forEach(conversation => {
            const startTime = new Date(conversation.timestamp);
            const endTime = new Date(conversation.completedAt || Date.now());
            totalTime += (endTime - startTime) / 1000;
        });
        const avgTime = Math.round(totalTime / completedConversations.length);
        avgResponseTimeEl.textContent = `${avgTime}s`;
    }
}

// Helper functions
function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString();
}

function capitalizeFirstLetter(string) {
    return string.charAt(0).toUpperCase() + string.slice(1);
}

function notifyUser(message) {
    // Check if browser supports notifications
    if (!("Notification" in window)) {
        return;
    }
    
    // Check if permission is already granted
    if (Notification.permission === "granted") {
        new Notification("BlueSky-AgentMesh Integration", {
            body: message,
            icon: "/favicon.ico"
        });
    }
    // Otherwise, request permission
    else if (Notification.permission !== "denied") {
        Notification.requestPermission().then(permission => {
            if (permission === "granted") {
                new Notification("BlueSky-AgentMesh Integration", {
                    body: message,
                    icon: "/favicon.ico"
                });
            }
        });
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', init);