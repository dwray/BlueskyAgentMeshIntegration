const axios = require('axios');
const FormData = require('form-data');

/**
 * Send a question to Agent Mesh and get a response
 * @param {string} question - The question to ask Agent Mesh
 * @param {string} model - Optional model name to use (defaults to system default if not specified)
 * @returns {Promise<string>} - The response from Agent Mesh
 */
async function askQuestion(question) {
  try {
    const apiUrl = process.env.AGENT_MESH_API_URL;
    
    if (!apiUrl) {
      throw new Error('Agent Mesh API URL not configured in .env file');
    }
    console.log('Agentmesh URL: ', apiUrl);
    console.log('Question: ', question);
    
    // Create FormData instance
    const formData = new FormData();
    
    // Add required parameters
    formData.append('prompt', question);
    formData.append('stream', 'false');
        
    // Make API request using FormData
    const response = await axios.post(
      apiUrl,
      formData,
      {
        headers: formData.getHeaders() // Important for Node.js
      }
    );
    
//    console.log(response.data);
    
    // Extract the content as a string from the response structure
    if (response.data && response.data.response && response.data.response.content) {
      return response.data.response.content;
    } else if (response.data && response.data.response) {
      // If response exists but no content property, stringify the response object
      return typeof response.data.response === 'string'
        ? response.data.response
        : JSON.stringify(response.data.response);
    } else {
      // Fallback to returning the entire response data as string
      return typeof response.data === 'string' 
        ? response.data 
        : JSON.stringify(response.data);
    }
  } catch (error) {
    console.error('Error calling Agent Mesh API:', error);
    
    // Enhanced error logging
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
      console.error('Response data:', error.response.data);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Request setup error:', error.message);
    }
    
    throw new Error(`Failed to get response from Agent Mesh: ${error.message}`);
  }
}

module.exports = {
  askQuestion
};