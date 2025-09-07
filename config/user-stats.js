const fs = require('fs');
const path = require('path');
require('module-alias')({ base: path.resolve(__dirname, '..', 'api') });
const { silentExit } = require('./helpers');
const Conversation = require('~/models/schema/convoSchema');
const { createToken, deleteTokens } = require('~/models');
const { createTokenHash, resetPassword } = require('~/server/services/AuthService');
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
      id: user_._id.toString(),
      conversations: [],
    };
    console.log('user: ', user.id, user.email);
    let conversations = user.conversations;
    for (const convo of (await Conversation.find({ user: user.id }))) {
      // console.log('  convo: ', user);
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

  // Read all documents from the 'users' collection, if 'password' is set in the document print it and remove it from the document
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();
  for (let doc of snapshot.docs) {
    if (doc.data().password) {
      console.log(`User ${doc.id} has password set: ${doc.data().password}`);
      const password = doc.data().password;
      const id = doc.id;
      await deleteTokens({ userId: id });

      const [resetToken, hash] = createTokenHash();

      await createToken({
        userId: id,
        token: hash,
        createdAt: Date.now(),
        expiresIn: 900,
      });

      const ret = await resetPassword(id, resetToken, password);
      console.log(`Reset password for user ${doc.id}: ${ret}`);

      // Remove password from document
      try {
        await doc.ref.update({ password: admin.firestore.FieldValue.delete() });
        console.log(`Removed password from user ${doc.id}`);
      } catch (error) {
        console.error(`Error removing password from user ${doc.id}: ${error}`);
      }
    }
  }
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
