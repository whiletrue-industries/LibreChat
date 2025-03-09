const fs = require('fs');
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const Conversation = require('~/models/schema/convoSchema');
const Message = require('~/models/schema/messageSchema');
const User = require('~/models/User');
const connect = require('./connect');
const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

(async () => {
  await connect();

  let users = await User.find({});
  let userData = [];
  for (const user_ of users) {
    let user = {
      name: user_.name,
      email: user_.email,
      conversations: [],
    };
    console.log('user: ', user);
    let conversations = user.conversations;
    for (const convo of (await Conversation.find({ user: user_._id }))) {
      console.log('  convo: ', user);
      let conversationMessages = await Message.find({ conversationId: convo.conversationId }).sort({ createdAt: 1 });
      let messageTimestamps = conversationMessages.map((message) => message.createdAt);
      let conversation = {
        conversationTime: convo.createdAt,
        messageCount: messageTimestamps.length,
        messageTimestamps,
      };
      conversations.push(conversation);
    }

    userData.push(user);
  }

  console.table(userData);
  // Write userData to json file
  fs.writeFileSync('userData.json', JSON.stringify(userData, null, 2));

  // Upload document to firebase
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  const db = admin.firestore();
  const docRef = await db.collection('user-stats').doc('user-stats');
  const ret = await docRef.set({
    userData,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('Document written with ID: ', ret);

  silentExit(0);
})();

process.on('uncaughtException', (err) => {
  if (!err.message.includes('fetch failed')) {
    console.error('There was an uncaught error:');
    console.error(err);
  }

  if (!err.message.includes('fetch failed')) {
    process.exit(1);
  }
});
