const { BskyAgent, RichText } = require('@atproto/api');

// Initialize BlueSky client
const agent = new BskyAgent({
  service: 'https://bsky.social'
});

// Store the current monitoring interval
let monitoringInterval = null;
let lastCheckedTime = null;
const processedMentions = new Set(); // Keep track of handled mentions

/**
 * Start monitoring BlueSky for mentions of the configured handle
 * @param {Function} callback - Function to call when a post is received
 */
async function startMonitoring(callback) {
  try {
    const blueskyHandle = process.env.BLUESKY_HANDLE;
    const blueskyPassword = process.env.BLUESKY_APP_PASSWORD;

    if (!blueskyHandle || !blueskyPassword) {
      throw new Error('BlueSky handle or app password not configured in .env file');
    }

    await agent.login({
      identifier: blueskyHandle,
      password: blueskyPassword
    });

    const myDid = agent.session.did;
    console.log(`Logged in as ${blueskyHandle} (${myDid})`);

    lastCheckedTime = new Date();

    monitoringInterval = setInterval(async () => {
      try {
        console.log('Checking for Notifications');

        const notifications = await agent.listNotifications({ limit: 50 });
        const newNotifs = notifications.data.notifications.filter(notif => {
          const createdAt = new Date(notif.indexedAt);
          return createdAt > lastCheckedTime && !processedMentions.has(notif.uri);
        });

        let maxIndexedAt = lastCheckedTime;

        for (const notif of newNotifs) {
          const createdAt = new Date(notif.indexedAt);
          if (createdAt > maxIndexedAt) {
            maxIndexedAt = createdAt;
          }

          const post = notif?.record;
          const postText = post?.text || '';

          // Check mention facets for our DID
          const mentionDids = post?.facets?.flatMap(f =>
            f.features
              .filter(f => f.$type === 'app.bsky.richtext.facet#mention')
              .map(f => f.did)
          ) || [];

          const explicitlyMentioned = mentionDids.includes(myDid);

          const shouldProcess =
            (notif.reason === 'mention' ||
             notif.reason === 'reply' ||
             explicitlyMentioned);

          if (!shouldProcess) continue;

          try {
            const blueskyPost = {
              id: notif.uri.split('/').pop(),
              cid: notif.cid,
              uri: notif.uri,
              text: postText,
              author_did: notif.author.did,
              author_username: notif.author.handle,
              created_at: notif.indexedAt
            };

            processedMentions.add(notif.uri);
            await callback(blueskyPost);
          } catch (error) {
            console.error('Error processing mention:', error);
          }
        }

        // Only update lastCheckedTime to the max observed, not Date.now()
        lastCheckedTime = maxIndexedAt;

      } catch (error) {
        if (error.name === 'XRPCError') {
          console.warn('Bluesky API error:', error.error, '-', error.status);
        } else {
          console.error('Error checking for mentions:', error);
        }
      }
    }, 15000); // Every 15 seconds

    console.log('BlueSky monitoring started successfully');
  } catch (error) {
    console.error('Error starting BlueSky monitoring:', error);
    throw error;
  }
}

/**
 * Stop monitoring BlueSky
 */
async function stopMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    console.log('BlueSky monitoring stopped');
  }
}

/**
 * Extract a question from post text
 * @param {string} postText - The text of the post
 * @returns {string|null} - The extracted question or null if no question found
 */
function extractQuestion(postText) {
  // Remove mentions from the post text
  const textWithoutMentions = postText.replace(/@[\w.]+(?:\.bsky\.social)?/g, '').trim();
  return textWithoutMentions;
}

/**
 * Reply to a post with the given response, optimized for BlueSky's 10-post thread limitation
 * @param {string} replyToUri - The URI of the post to reply to
 * @param {string} response - The response text
 * @returns {boolean} - True if successful, false if failed
 */
async function replyToPost(replyToUri, response) {
  try {
    const maxGraphemes = 300; // BlueSky's character limit per post (in graphemes)
    const maxThreadLength = 9; // Maximum number of replies in a thread (10 total including original post)
    
    // Check if the post exists first
    const threadResult = await agent.getPostThread({ uri: replyToUri });
    const postToReplyTo = threadResult?.data?.thread?.post;

    if (!postToReplyTo) {
      console.warn(`Cannot reply — original post not found: ${replyToUri}`);
      return false;
    }

    if (countGraphemes(response) <= maxGraphemes) {
      // Single post reply
      await createReply(replyToUri, response);
      return true;
    } else {
      // Split into chunks
      const chunks = splitTextIntoGraphemeChunks(response, maxGraphemes - 20); // Leave room for "(1/n) "
      
      // If we have too many chunks, we need a different strategy
      if (chunks.length > maxThreadLength) {
        return await createMultipartResponse(replyToUri, postToReplyTo.cid, chunks, maxThreadLength);
      } else {
        // Standard threading for responses that fit within visible limits
        return await createThreadedResponse(replyToUri, postToReplyTo.cid, chunks);
      }
    }
  } catch (error) {
    console.error('Error replying to post:', error);
    return false;
  }
}

/**
 * Create a standard threaded response where all posts are in a single thread
 * @param {string} rootUri - URI of the original post
 * @param {string} rootCid - CID of the original post
 * @param {string[]} chunks - Array of text chunks to post
 * @returns {boolean} - True if successful, false if failed
 */
async function createThreadedResponse(rootUri, rootCid, chunks) {
  try {
    // Create the first reply (this will be our thread root)
    const threadPrefix = `(1/${chunks.length}) `;
    const firstReplyText = threadPrefix + chunks[0];
    const firstReply = await createReply(rootUri, firstReplyText);
    
    // Create remaining replies in the thread
    let previousPostUri = firstReply.uri;
    let previousPostCid = firstReply.cid;
    
    for (let i = 1; i < chunks.length; i++) {
      // Wait between posts to prevent rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000)); 
      
      const threadPrefix = `(${i + 1}/${chunks.length}) `;
      const replyText = threadPrefix + chunks[i];
      
      // Create a reply in the thread structure
      const reply = await createThreadedReply({
        rootUri,
        rootCid,
        parentUri: previousPostUri,
        parentCid: previousPostCid,
        text: replyText
      });
      
      previousPostUri = reply.uri;
      previousPostCid = reply.cid;
    }
    
    return true;
  } catch (error) {
    console.error('Error creating threaded response:', error);
    return false;
  }
}

/**
 * Create a multi-part response for very long answers that exceed BlueSky's thread visibility
 * @param {string} rootUri - URI of the original post
 * @param {string} rootCid - CID of the original post
 * @param {string[]} chunks - Array of text chunks to post
 * @param {number} maxThreadLength - Maximum number of posts in a visible thread
 * @returns {boolean} - True if successful, false if failed
 */
async function createMultipartResponse(rootUri, rootCid, chunks, maxThreadLength) {
  try {
    // Calculate how many parts we'll need
    const totalChunks = chunks.length;
    const numParts = Math.ceil(totalChunks / maxThreadLength);
    
    // Add a summary reply first to let users know about multiple parts
    const summaryText = `Your question requires a detailed answer that will be posted in ${numParts} parts. Each part will contain up to ${maxThreadLength} posts in a thread. Please check my recent posts or notifications to see all parts.`;
    await createReply(rootUri, summaryText);
    
    // Wait between posts
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Create each part as a separate thread
    for (let part = 0; part < numParts; part++) {
      // Calculate which chunks belong to this part
      const startIndex = part * maxThreadLength;
      const endIndex = Math.min(startIndex + maxThreadLength, totalChunks);
      const partChunks = chunks.slice(startIndex, endIndex);
      
      // Create a new thread for this part
      const partPrefix = `PART ${part + 1}/${numParts}: `;
      const firstChunkInPart = partPrefix + partChunks[0];
      
      // First post in this part's thread - reply directly to original post
      const firstReply = await createReply(rootUri, firstChunkInPart);
      
      // For remaining chunks in this part, create a thread
      let previousPostUri = firstReply.uri;
      let previousPostCid = firstReply.cid;
      
      for (let i = 1; i < partChunks.length; i++) {
        // Wait between posts to prevent rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Global chunk number and part chunk number for clear labeling
        const partIndex = i + 1;
        
        const threadPrefix = `PART ${part + 1}/${numParts} (${partIndex}/${partChunks.length}): `;
        const replyText = threadPrefix + partChunks[i];
        
        // Create a reply in the thread structure
        const reply = await createThreadedReply({
          rootUri,
          rootCid,
          parentUri: previousPostUri,
          parentCid: previousPostCid,
          text: replyText
        });
        
        previousPostUri = reply.uri;
        previousPostCid = reply.cid;
      }
      
      // Wait a bit longer between parts
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    return true;
  } catch (error) {
    console.error('Error creating multi-part response:', error);
    return false;
  }
}

/**
 * Create a reply to a post
 * @param {string} replyToUri - The URI of the post to reply to
 * @param {string} text - The text of the reply
 * @returns {Object} - The created post { uri, cid }
 */
async function createReply(replyToUri, text) {
  try {
    // Get the thread containing the original post - fetch this EVERY time
    const threadResult = await agent.getPostThread({ uri: replyToUri });

    const postToReplyTo = threadResult?.data?.thread?.post;
    if (!postToReplyTo) {
      throw new Error(`Unable to fetch post for reply: ${replyToUri}`);
    }

    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    const response = await agent.post({
      text: rt.text,
      facets: rt.facets,
      reply: {
        root: {
          uri: postToReplyTo.uri,
          cid: postToReplyTo.cid
        },
        parent: {
          uri: postToReplyTo.uri,
          cid: postToReplyTo.cid
        }
      },
      langs: ['en'],
      createdAt: new Date().toISOString()
    });

    console.log(`Reply created successfully: ${response.uri}`);
    return {
      uri: response.uri,
      cid: response.cid
    };
  } catch (error) {
    console.error('Error creating reply:', error?.response?.data || error);
    throw error;
  }
}

/**
 * Create a reply that's properly threaded with both root and parent references
 * @param {Object} params - Parameters for creating a threaded reply
 * @param {string} params.rootUri - URI of the root post (original post)
 * @param {string} params.rootCid - CID of the root post
 * @param {string} params.parentUri - URI of the parent post (previous reply)
 * @param {string} params.parentCid - CID of the parent post
 * @param {string} params.text - Text of the reply
 * @returns {Object} - The created post { uri, cid }
 */
async function createThreadedReply({ rootUri, rootCid, parentUri, parentCid, text }) {
  try {
    const rt = new RichText({ text });
    await rt.detectFacets(agent);

    const response = await agent.post({
      text: rt.text,
      facets: rt.facets,
      reply: {
        // Root is the original post that started the thread
        root: {
          uri: rootUri,
          cid: rootCid
        },
        // Parent is the post we're directly replying to
        parent: {
          uri: parentUri,
          cid: parentCid
        }
      },
      langs: ['en'],
      createdAt: new Date().toISOString()
    });

    console.log(`Thread reply created successfully: ${response.uri}`);
    return {
      uri: response.uri,
      cid: response.cid
    };
  } catch (error) {
    console.error('Error creating threaded reply:', error?.response?.data || error);
    throw error;
  }
}

/**
 * Count the number of graphemes in a string using Intl.Segmenter
 * @param {string} text - The text to count
 * @returns {number} - The number of graphemes
 */
function countGraphemes(text) {
  if (!text) return 0;
  
  // Use Intl.Segmenter to properly count graphemes
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = segmenter.segment(text);
  return Array.from(segments).length;
}

/**
 * Split text into chunks based on grapheme count
 * @param {string} text - The text to split
 * @param {number} maxGraphemes - The maximum number of graphemes per chunk
 * @returns {string[]} - Array of text chunks
 */
function splitTextIntoGraphemeChunks(text, maxGraphemes) {
  const chunks = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  
  // Split by sentences to try to keep coherent chunks
  const sentences = text.split(/(?<=[.!?])\s+/);
  
  let currentChunk = '';
  
  for (const sentence of sentences) {
    const combinedText = currentChunk + (currentChunk ? ' ' : '') + sentence;
    
    if (countGraphemes(combinedText) <= maxGraphemes) {
      currentChunk = combinedText;
    } else {
      // If current chunk is not empty, add it to chunks
      if (currentChunk) {
        chunks.push(currentChunk);
      }
      
      // If a single sentence is longer than maxGraphemes, split it
      if (countGraphemes(sentence) > maxGraphemes) {
        const words = sentence.split(' ');
        let tempChunk = '';
        
        for (const word of words) {
          const potentialChunk = tempChunk + (tempChunk ? ' ' : '') + word;
          
          if (countGraphemes(potentialChunk) <= maxGraphemes) {
            tempChunk = potentialChunk;
          } else {
            if (tempChunk) {
              chunks.push(tempChunk);
            }
            
            // If a single word is too long, we need to split the word itself
            if (countGraphemes(word) > maxGraphemes) {
              const wordChunks = splitWordIntoGraphemeChunks(word, maxGraphemes);
              chunks.push(...wordChunks.slice(0, -1));
              tempChunk = wordChunks[wordChunks.length - 1];
            } else {
              tempChunk = word;
            }
          }
        }
        
        if (tempChunk) {
          currentChunk = tempChunk;
        } else {
          currentChunk = '';
        }
      } else {
        currentChunk = sentence;
      }
    }
  }
  
  if (currentChunk) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Split a single word into grapheme chunks if it's longer than maxGraphemes
 * @param {string} word - The word to split
 * @param {number} maxGraphemes - Maximum graphemes per chunk
 * @returns {string[]} - Array of word chunks
 */
function splitWordIntoGraphemeChunks(word, maxGraphemes) {
  const chunks = [];
  const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  const segments = Array.from(segmenter.segment(word));
  
  for (let i = 0; i < segments.length; i += maxGraphemes) {
    const chunk = segments.slice(i, i + maxGraphemes)
      .map(segment => segment.segment)
      .join('');
    chunks.push(chunk);
  }
  
  return chunks;
}

/**
 * Convert markdown formatted text to Bluesky-compatible formatting
 * @param {string} markdownText - The markdown text to convert
 * @returns {string} - Bluesky-compatible formatted text
 */
function markdownToBluesky(markdownText) {
  if (!markdownText) return '';

  let result = markdownText;

  // Remove code blocks (```...```)
  result = result.replace(/```[\s\S]*?```/g, '');

  // Remove inline code (`...`)
  result = result.replace(/`([^`]+)`/g, '$1');

  // Remove bold (**text** or __text__)
  result = result.replace(/(\*\*|__)(.*?)\1/g, '$2');

  // Remove italic (*text* or _text_)
  result = result.replace(/(\*|_)(.*?)\1/g, '$2');

  // Replace markdown links [text](url) with just the text + URL in parentheses
  result = result.replace(/\[(.*?)\]\((.*?)\)/g, (match, text, url) => {
    return text ? `${text} (${url})` : url;
  });

  // Remove headings (# Header) → keep just the text
  result = result.replace(/^#{1,6}\s+(.*)$/gm, '$1');

  // Remove blockquotes (> quote)
  result = result.replace(/^>\s+/gm, '');

  // Remove horizontal rules (---)
  result = result.replace(/^---+$/gm, '');

  // Normalize multiple blank lines
  result = result.replace(/\n{3,}/g, '\n\n');

  // Trim extra spaces
  return result.trim();
}

module.exports = {
  startMonitoring,
  stopMonitoring,
  extractQuestion,
  replyToPost,
  markdownToBluesky
};