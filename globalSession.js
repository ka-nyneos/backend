module.exports.logoutUser = async (req, res) => {
  const { userId } = req.body;
  
  if (!userId) {
    return res.status(400).json({ success: false, message: "User ID is required" });
  }

  // Convert userId to number if it comes as string
  const numericUserId = Number(userId);
  
  console.log("Attempting to logout user:", numericUserId);
  console.log("Current sessions before:", globalSession.UserSessions);
  
  const remainingSessions = globalSession.clearSession(numericUserId);
  
  console.log("Remaining sessions after:", remainingSessions);
  console.log("Internal session map:", globalSession._getSessionMap());
  
  res.json({ 
    success: true, 
    message: "Logout successful",
    remainingSessions: remainingSessions.length
  });
};
