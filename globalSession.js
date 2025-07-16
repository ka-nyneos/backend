// globalSession.js
let UserSessions = [];

const globalSession = {
  Versions: ['0.0.6'],
  DepVersions: ['0.0.1'],
  WhiteLabelNames: ['Cashinvoice'],
  
  get UserSessions() {
    return UserSessions;
  },
  
  addSession: (sessionData) => {
    const existingIndex = UserSessions.findIndex(u => u.userId === sessionData.userId);
    if (existingIndex !== -1) {
      UserSessions[existingIndex] = sessionData;
    } else {
      UserSessions.push(sessionData);
    }
  },
  
  getSession: (userId) => {
    return UserSessions.find(u => u.userId === userId);
  },
  
  clearSession: (userId) => {
    UserSessions = UserSessions.filter(u => u.userId !== userId);
  }
};

module.exports = globalSession; // Changed from module.exports.globalSession