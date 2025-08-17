import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  onSnapshot,
  addDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
  deleteDoc,
  serverTimestamp,
  runTransaction,
  where,
  limit,
  setDoc,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js";
import {
  getStorage,
  ref,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-storage.js";

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyD_URV0MAg7L6jho6Rcuwc47reakhyv7Hg",
  authDomain: "collegeconnect-9ad89.firebaseapp.com",
  projectId: "collegeconnect-9ad89",
  storageBucket: "collegeconnect-9ad89.firebasestorage.app",
  messagingSenderId: "348147420019",
  appId: "1:348147420019:web:d1588e5f73bc7cb1ec9306",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// ==================== AUTH STATE LISTENER ====================
let unsubscribers = [];

onAuthStateChanged(auth, async (user) => {
  // Clear previous listeners
  unsubscribers.forEach((unsub) => {
    try {
      unsub();
    } catch {}
  });
  unsubscribers = [];

  if (!user) {
    console.warn("User not logged in - dashboard listeners cleared.");
    currentUser = null;
    currentUserData = null;
    return;
  }

  currentUser = user;
  currentUserData = await getCurrentUserData();

  // Ensure profile has courseId & sectionId for timetable
  if (!currentUserData.courseId || !currentUserData.sectionId) {
    showToast(
      "Please update your profile with Course & Section to view timetable",
      "warning",
      5000
    );
  } else {
    initTimetableListener(currentUserData.courseId, currentUserData.sectionId);
  }

  // Load other real-time features
  loadOnlineUsers();
  loadFiles();
  loadChatMessages();
});

// ==================== TIMETABLE LOADER ====================
function initTimetableListener(courseId, sectionId) {
  try {
    const timetableRef = collection(
      db,
      "timetable",
      courseId,
      "sections",
      sectionId,
      "classes"
    );
    const unsub = onSnapshot(
      timetableRef,
      (snapshot) => {
        if (snapshot.empty) {
          console.warn("No timetable available");
          // TODO: Render a placeholder in UI
          return;
        }
        snapshot.forEach((doc) => {
          console.log("Class:", doc.id, doc.data());
          // TODO: Render class in timetable UI
        });
      },
      (error) => {
        console.error("Timetable onSnapshot error:", error);
      }
    );
    unsubscribers.push(unsub);
  } catch (e) {
    console.error("Error loading timetable:", e);
  }
}

// ------------------- Chat & Presence Helpers -------------------
// ImageKit uploader (guarded to avoid redeclaration)
if (!window.uploadToImageKit) {
  window.uploadToImageKit = async function (file) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("fileName", file.name);
    formData.append("folder", "/chat-files");

    const response = await fetch(
      "https://upload.imagekit.io/api/v1/files/upload",
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa("YOUR_IMAGEKIT_PUBLIC_KEY:"), // <-- replace with your public key
        },
        body: formData,
      }
    );

    const data = await response.json();
    if (data.url) return data.url;
    throw new Error("ImageKit upload failed");
  };
}

// Toggle reaction on a message (uses arrayUnion / arrayRemove)
if (!window.addReaction) {
  window.addReaction = async function (messageId, emoji) {
    try {
      const msgRef = doc(db, "messages", messageId);
      // read current reactions
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(msgRef);
        if (!snap.exists()) return;
        const data = snap.data();
        const reactions = data.reactions || {};
        const uid = currentUser?.uid;
        if (!uid) return;

        const users = reactions[emoji] || [];
        const has = users.includes(uid);

        if (has) {
          // remove user from array
          const updated = users.filter((id) => id !== uid);
          const upd = Object.assign({}, reactions);
          if (updated.length) upd[emoji] = updated;
          else delete upd[emoji];
          tx.update(msgRef, { reactions: upd });
        } else {
          // add user
          const upd = Object.assign({}, reactions);
          upd[emoji] = Array.from(new Set([...(upd[emoji] || []), uid]));
          tx.update(msgRef, { reactions: upd });
        }
      });
    } catch (err) {
      console.error("addReaction error:", err);
    }
  };
}

// Presence: write user's online status to users collection
if (!window.setupPresence) {
  window.setupPresence = function () {
    try {
      if (!currentUser) return;
      const userRef = doc(db, "users", currentUser.uid);
      // set online status
      setDoc(
        userRef,
        {
          displayName:
            currentUserData?.fullName ||
            currentUserData?.displayName ||
            "Unknown",
          role: currentUserData?.role || "student",
          status: "online",
          lastSeen: serverTimestamp(),
        },
        { merge: true }
      );

      // on unload set offline
      window.addEventListener("beforeunload", async () => {
        try {
          await updateDoc(userRef, {
            status: "offline",
            lastSeen: serverTimestamp(),
          });
        } catch (e) {
          console.warn("Failed to set offline status:", e);
        }
      });
    } catch (e) {
      console.error("setupPresence error:", e);
    }
  };
}

if (!window.loadOnlineUsers) {
  window.loadOnlineUsers = function () {
    const onlineListEl = document.getElementById("onlineUsersList");
    if (!onlineListEl) return;
    const q = query(collection(db, "users"), where("status", "==", "online"));
    onSnapshot(q, (snap) => {
      const users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      onlineListEl.innerHTML = users
        .map(
          (u) => `
        <div class="flex items-center gap-3 p-3 rounded-xl hover:bg-white transition-colors ${
          u.id === currentUser?.uid ? "bg-blue-50 border border-blue-200" : ""
        }">
          <div class="w-10 h-10 ${
            u.status === "online" ? "bg-green-500" : "bg-gray-400"
          } rounded-full flex items-center justify-center text-white text-sm font-medium">
            ${(u.displayName || "U")
              .split(" ")
              .map((n) => n[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
          <div class="flex-1">
            <div class="text-gray-900 text-sm font-medium">${u.displayName} ${
            u.id === currentUser?.uid ? "(You)" : ""
          }</div>
            <div class="text-gray-500 text-xs capitalize">${u.role || ""}</div>
          </div>
          <div class="w-2 h-2 ${
            u.status === "online" ? "bg-green-400" : "bg-gray-300"
          } rounded-full"></div>
        </div>
      `
        )
        .join("");
    });
  };
}
// Global State Management
let currentUser = null;
let currentUserData = null;
let realTimeListeners = new Map();
let chatUnsubscribe = null;
let filesUnsubscribe = null;
let eventsUnsubscribe = null;
let pollsUnsubscribe = null;
let attendanceOverviewChart;
let courseAttendanceChart;
let attendanceTrendsChart;

// --------------- ImageKit.io Configuration ----------------
/*const IMAGEKIT_CONFIG = {
  publicKey: "public_aTE5JJek9Za9N0XM4KIgzX2EKAc=",
  uploadUrl: "https://upload.imagekit.io/api/v1/Files/upload",
  folder: "/Files", // or "" for root
};*/

// Enhanced Role-based Permissions
const PERMISSIONS = {
  student: {
    canCreateFiles: false,
    canDeleteFiles: false,
    canCreatePolls: false,
    canDeletePolls: false,
    canCreateEvents: false,
    canDeleteEvents: false,
    canManageUsers: false,
    canVotePolls: true,
    canViewFiles: true,
    canDownloadFiles: true,
    canChat: true,
    canViewTimetable: true,
    canViewEvents: true,
    canEditOwnProfile: true,
  },
  faculty: {
    canCreateFiles: true,
    canDeleteFiles: true,
    canCreatePolls: true,
    canDeletePolls: true,
    canCreateEvents: true,
    canDeleteEvents: true,
    canManageUsers: false,
    canVotePolls: true,
    canViewFiles: true,
    canDownloadFiles: true,
    canChat: true,
    canViewTimetable: true,
    canViewEvents: true,
    canEditOwnProfile: true,
    canModerateContent: true,
    canCreateTimetable: true,
  },
  admin: {
    canCreateFiles: true,
    canDeleteFiles: true,
    canCreatePolls: true,
    canDeletePolls: true,
    canCreateEvents: true,
    canDeleteEvents: true,
    canManageUsers: true,
    canVotePolls: true,
    canViewFiles: true,
    canDownloadFiles: true,
    canChat: true,
    canViewTimetable: true,
    canViewEvents: true,
    canEditOwnProfile: true,
    canModerateContent: true,
    canDeleteAnyContent: true,
    canBanUsers: true,
    canAccessAnalytics: true,
    canCreateTimetable: true,
  },
};

function hasPermission(permissionKey) {
  if (!currentUserData) return false;
  const userRole = currentUserData.role || "student";
  const rolePermissions = PERMISSIONS[userRole];
  return rolePermissions ? rolePermissions[permissionKey] || false : false;
}

function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add("show");
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove("show");
}

// Enhanced User Management
async function getCurrentUserData() {
  if (!currentUser) {
    console.warn("No current user available");
    return null;
  }
  try {
    const userDocRef = doc(db, "users", currentUser.uid);
    const userSnap = await getDoc(userDocRef);

    if (userSnap.exists()) {
      const userData = userSnap.data();
      // This should be 'faculty' for you!
      console.log("📄 Fetched user data:", userData);
      currentUserData = userData;
      return userData;
    } else {
      // Only set role to student for *new* users, not existing
      const basicUserData = {
        displayName:
          currentUser.displayName || currentUser.email?.split("@")[0] || "User",
        email: currentUser.email,
        role: "student", // <<---------- Only for NEW, not EXISTING
        createdAt: serverTimestamp(),
      };
      await setDoc(userDocRef, basicUserData);
      currentUserData = basicUserData;
      return basicUserData;
    }
  } catch (error) {
    console.error("❌ Error fetching user data:", error);
    return null;
  }
}

async function updateUserUI() {
  console.log("🔄 Updating user UI...");

  const userData = await getCurrentUserData();
  if (!userData) {
    console.warn("No user data available for UI update");
    return;
  }

  const displayName =
    userData.fullName ||
    userData.displayName ||
    currentUser?.displayName ||
    currentUser?.email?.split("@")[0] ||
    "User";

  console.log("👤 Display name resolved to:", displayName);

  // Update UI elements
  const welcomeEl = document.getElementById("welcomeMessage");
  if (welcomeEl) {
    welcomeEl.innerHTML = `
    Welcome back, <span class="font-bold">${displayName}</span>!
    <span class="not-gradient ml-2">
      <i class="fa-solid fa-graduation-cap"></i>
    </span>
  `;
  }

  const userDisplayName = document.getElementById("userDisplayName");
  if (userDisplayName) {
    userDisplayName.textContent = displayName;
  }

  const roleBadgeEl = document.getElementById("roleBadge");
  if (roleBadgeEl) {
    roleBadgeEl.textContent =
      (userData.role || "student").charAt(0).toUpperCase() +
      (userData.role || "student").slice(1);
  }

  const userAvatarEl = document.getElementById("userAvatar");
  if (userAvatarEl) {
    const initials = displayName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase();
    userAvatarEl.textContent = initials;
  }

  // Update role-based UI
  updateRoleBasedUI();

  console.log("✅ UI update completed");
}

function updateRoleBasedUI() {
  if (!currentUserData) return;

  // Show/hide upload button based on permissions
  const filesActions = document.getElementById("filesActions");
  if (filesActions) {
    if (hasPermission("canCreateFiles")) {
      filesActions.classList.remove("hidden");
    } else {
      filesActions.classList.add("hidden");
    }
  }

  // Show/hide year field for students
  const yearField = document.getElementById("yearField");
  if (yearField) {
    if (currentUserData.role === "student") {
      yearField.classList.remove("hidden");
    } else {
      yearField.classList.add("hidden");
    }
  }
}

// Enhanced Profile Management
/*async function loadProfileData() {
  if (!auth.currentUser) return;

  const userRef = doc(db, "users", auth.currentUser.uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    const data = userSnap.data();

    // View mode fields
    document.getElementById("profileName").textContent = data.fullName || "";
    document.getElementById("profileEmail").textContent =
      data.email || auth.currentUser.email || "";
    document.getElementById("profileRoleBadge").textContent = data.role || "";
    document.getElementById("profileFullName").textContent =
      data.fullName || "";
    document.getElementById("profileEmailField").textContent = data.email || "";
    document.getElementById("profileRoleField").textContent = data.role || "";
    document.getElementById("profilePhone").textContent = data.phone || "";
    document.getElementById("profileCollege").textContent = data.college || "";
    document.getElementById("profileCourse").textContent = data.course || "";
    document.getElementById("profileSection").textContent = data.section || "";

    // Edit mode fields
    document.getElementById("editFullName").value = data.fullName || "";
    document.getElementById("editPhone").value = data.phone || "";
    document.getElementById("editCollege").value = data.college || "";

    // Load courses dropdown
    await populateCoursesDropdown(data.course, data.section);
  }
}*/

// Populate courses dropdown from Firestore
/*async function populateCoursesDropdown(
  selectedCourse = "",
  selectedSection = ""
) {
  const courseSelect = document.getElementById("editCourse");
  const sectionSelect = document.getElementById("editSection");

  courseSelect.innerHTML = '<option value="">Select Course</option>';
  sectionSelect.innerHTML = '<option value="">Select Section</option>';

  const coursesSnap = await getDocs(collection(db, "courses"));
  coursesSnap.forEach((docSnap) => {
    const courseName = docSnap.data().name;
    const opt = document.createElement("option");
    opt.value = courseName;
    opt.textContent = courseName;
    if (selectedCourse && selectedCourse === courseName) opt.selected = true;
    courseSelect.appendChild(opt);
  });

  // Load sections if course selected
  if (selectedCourse) {
    await populateSectionsDropdown(selectedCourse, selectedSection);
  }

  // On course change, load sections
  courseSelect.addEventListener("change", async (e) => {
    await populateSectionsDropdown(e.target.value);
  });
}*/

// Populate sections dropdown based on course
/*async function populateSectionsDropdown(courseName, selectedSection = "") {
  const sectionSelect = document.getElementById("editSection");
  sectionSelect.innerHTML = '<option value="">Select Section</option>';

  if (!courseName) return;

  const coursesSnap = await getDocs(collection(db, "courses"));
  let courseId = null;
  coursesSnap.forEach((docSnap) => {
    if (docSnap.data().name === courseName) {
      courseId = docSnap.id;
    }
  });
  if (!courseId) return;

  const sectionsSnap = await getDocs(
    collection(db, "courses", courseId, "sections")
  );
  sectionsSnap.forEach((secSnap) => {
    const secName = secSnap.data().name;
    const opt = document.createElement("option");
    opt.value = secName;
    opt.textContent = secName;
    if (selectedSection && selectedSection === secName) opt.selected = true;
    sectionSelect.appendChild(opt);
  });
}*/

// Handle avatar upload via ImageKit
document.getElementById("profileAvatarLarge").addEventListener("click", () => {
  document.getElementById("avatarUploadInput").click();
});

document
  .getElementById("avatarUploadInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "YOUR_IMAGEKIT_UPLOAD_PRESET");

      const res = await fetch("YOUR_IMAGEKIT_UPLOAD_URL", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data && data.url) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          avatar: data.url,
        });
        // Refresh profile
        loadProfileData();
      }
    } catch (err) {
      console.error("Error uploading avatar:", err);
    }
  });

// Edit & Save button logic
document.getElementById("editProfileBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.add("hidden");
  document.getElementById("profileEditSection").classList.remove("hidden");
  document.getElementById("editProfileBtn").classList.add("hidden");
  document.getElementById("saveProfileBtn").classList.remove("hidden");
  document.getElementById("cancelEditBtn").classList.remove("hidden");
});

document.getElementById("cancelEditBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.remove("hidden");
  document.getElementById("profileEditSection").classList.add("hidden");
  document.getElementById("editProfileBtn").classList.remove("hidden");
  document.getElementById("saveProfileBtn").classList.add("hidden");
  document.getElementById("cancelEditBtn").classList.add("hidden");
});

document
  .getElementById("saveProfileBtn")
  .addEventListener("click", async () => {
    const updatedData = {
      fullName: document.getElementById("editFullName").value,
      phone: document.getElementById("editPhone").value,
      college: document.getElementById("editCollege").value,
      course: document.getElementById("editCourse").value,
      section: document.getElementById("editSection").value,
    };
    await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);
    await loadProfileData();
    document.getElementById("profileViewSection").classList.remove("hidden");
    document.getElementById("profileEditSection").classList.add("hidden");
    document.getElementById("editProfileBtn").classList.remove("hidden");
    document.getElementById("saveProfileBtn").classList.add("hidden");
    document.getElementById("cancelEditBtn").classList.add("hidden");
  });

// Handle avatar upload via ImageKit
document.getElementById("profileAvatarLarge").addEventListener("click", () => {
  document.getElementById("avatarUploadInput").click();
});

document
  .getElementById("avatarUploadInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "YOUR_IMAGEKIT_UPLOAD_PRESET");

      const res = await fetch("YOUR_IMAGEKIT_UPLOAD_URL", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data && data.url) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          avatar: data.url,
        });
        // Refresh profile
        loadProfileData();
      }
    } catch (err) {
      console.error("Error uploading avatar:", err);
    }
  });

// Edit & Save button logic
document.getElementById("editProfileBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.add("hidden");
  document.getElementById("profileEditSection").classList.remove("hidden");
  document.getElementById("editProfileBtn").classList.add("hidden");
  document.getElementById("saveProfileBtn").classList.remove("hidden");
  document.getElementById("cancelEditBtn").classList.remove("hidden");
});

document.getElementById("cancelEditBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.remove("hidden");
  document.getElementById("profileEditSection").classList.add("hidden");
  document.getElementById("editProfileBtn").classList.remove("hidden");
  document.getElementById("saveProfileBtn").classList.add("hidden");
  document.getElementById("cancelEditBtn").classList.add("hidden");
});

document
  .getElementById("saveProfileBtn")
  .addEventListener("click", async () => {
    const updatedData = {
      fullName: document.getElementById("editFullName").value,
      phone: document.getElementById("editPhone").value,
      college: document.getElementById("editCollege").value,
      course: document.getElementById("editCourse").value,
      section: document.getElementById("editSection").value,
    };
    await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);
    await loadProfileData();
    document.getElementById("profileViewSection").classList.remove("hidden");
    document.getElementById("profileEditSection").classList.add("hidden");
    document.getElementById("editProfileBtn").classList.remove("hidden");
    document.getElementById("saveProfileBtn").classList.add("hidden");
    document.getElementById("cancelEditBtn").classList.add("hidden");
  });

// Populate sections dropdown based on course
/*async function populateSectionsDropdown(courseName, selectedSection = "") {
  const sectionSelect = document.getElementById("editSection");
  sectionSelect.innerHTML = '<option value="">Select Section</option>';

  if (!courseName) return;

  const coursesSnap = await getDocs(collection(db, "courses"));
  let courseId = null;
  coursesSnap.forEach((docSnap) => {
    if (docSnap.data().name === courseName) {
      courseId = docSnap.id;
    }
  });
  if (!courseId) return;

  const sectionsSnap = await getDocs(
    collection(db, "courses", courseId, "sections")
  );
  sectionsSnap.forEach((secSnap) => {
    const secName = secSnap.data().name;
    const opt = document.createElement("option");
    opt.value = secName;
    opt.textContent = secName;
    if (selectedSection && selectedSection === secName) opt.selected = true;
    sectionSelect.appendChild(opt);
  });
}*/

// Handle avatar upload via ImageKit
document.getElementById("profileAvatarLarge").addEventListener("click", () => {
  document.getElementById("avatarUploadInput").click();
});

document
  .getElementById("avatarUploadInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "YOUR_IMAGEKIT_UPLOAD_PRESET");

      const res = await fetch("YOUR_IMAGEKIT_UPLOAD_URL", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data && data.url) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          avatar: data.url,
        });
        // Refresh profile
        loadProfileData();
      }
    } catch (err) {
      console.error("Error uploading avatar:", err);
    }
  });

// Edit & Save button logic
document.getElementById("editProfileBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.add("hidden");
  document.getElementById("profileEditSection").classList.remove("hidden");
  document.getElementById("editProfileBtn").classList.add("hidden");
  document.getElementById("saveProfileBtn").classList.remove("hidden");
  document.getElementById("cancelEditBtn").classList.remove("hidden");
});

document.getElementById("cancelEditBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.remove("hidden");
  document.getElementById("profileEditSection").classList.add("hidden");
  document.getElementById("editProfileBtn").classList.remove("hidden");
  document.getElementById("saveProfileBtn").classList.add("hidden");
  document.getElementById("cancelEditBtn").classList.add("hidden");
});

document
  .getElementById("saveProfileBtn")
  .addEventListener("click", async () => {
    const updatedData = {
      fullName: document.getElementById("editFullName").value,
      phone: document.getElementById("editPhone").value,
      college: document.getElementById("editCollege").value,
      course: document.getElementById("editCourse").value,
      section: document.getElementById("editSection").value,
    };
    await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);
    await loadProfileData();
    document.getElementById("profileViewSection").classList.remove("hidden");
    document.getElementById("profileEditSection").classList.add("hidden");
    document.getElementById("editProfileBtn").classList.remove("hidden");
    document.getElementById("saveProfileBtn").classList.add("hidden");
    document.getElementById("cancelEditBtn").classList.add("hidden");
  });

async function handleProfileSubmit(e) {
  e.preventDefault();

  if (!currentUser) {
    showToast("Please log in to update your profile", "error");
    return;
  }

  try {
    const formData = new FormData(e.target);
    const updatedData = {
      fullName: formData.get("fullName"),
      phone: formData.get("phone"),
      dob: formData.get("dob"),
      gender: formData.get("gender"),
      college: formData.get("college"),
      department: formData.get("department"),
      year: formData.get("year"),
      bio: formData.get("bio"),
      updatedAt: serverTimestamp(),
    };

    // Remove empty fields
    Object.keys(updatedData).forEach((key) => {
      if (updatedData[key] === "" && key !== "updatedAt") {
        delete updatedData[key];
      }
    });

    const userDocRef = doc(db, "users", currentUser.uid);
    await updateDoc(userDocRef, updatedData);

    // Update local user data
    Object.assign(currentUserData, updatedData);

    // Update UI
    await updateUserUI();
    closeModal("profileModal");
    showToast("Profile updated successfully!", "success");
  } catch (error) {
    console.error("Error updating profile:", error);
    showToast("Error updating profile. Please try again.", "error");
  }
}

// Enhanced Chat Management

async function loadChatMessages() {
  const chatMessages = document.getElementById("chatMessages");
  if (!chatMessages) return;

  try {
    if (chatUnsubscribe) {
      chatUnsubscribe();
    }

    const messagesQuery = query(
      collection(db, "messages"),
      orderBy("timestamp", "desc"),
      limit(100)
    );

    chatUnsubscribe = onSnapshot(messagesQuery, (snapshot) => {
      const messages = snapshot.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .reverse();

      if (messages.length === 0) {
        chatMessages.innerHTML = `
          <div class="text-center py-12 text-gray-500">
            <div class="text-6xl mb-4">💬</div>
            <p class="text-lg">No messages yet</p>
            <p class="text-sm">Be the first to start the conversation!</p>
          </div>
        `;
        return;
      }

      chatMessages.innerHTML = messages
        .map((message) => {
          const isOwnMessage = message.authorId === currentUser?.uid;

          // content: text or file
          let contentHTML = "";
          if (message.type === "file" && message.fileUrl) {
            if (/\.(jpg|jpeg|png|gif|webp)$/i.test(message.fileUrl)) {
              contentHTML = `<img src="${message.fileUrl}" class="max-w-xs rounded-lg mt-2" />`;
            } else {
              contentHTML = `<a href="${message.fileUrl}" target="_blank" class="underline text-sm mt-2 block">📎 Open File</a>`;
            }
            if (message.text) {
              contentHTML =
                `<div class="break-words">${message.text}</div>` + contentHTML;
            }
          } else {
            contentHTML = `<div class="break-words">${
              message.text || ""
            }</div>`;
          }

          const reactionButtons = ["👍", "❤️", "😂", "🔥"]
            .map(
              (emoji) => `
                <button 
                  onclick="addReaction('${message.id}', '${emoji}')" 
                  class="px-2 py-1 text-sm hover:bg-gray-200 rounded">
                  ${emoji} ${message.reactions?.[emoji]?.length || ""}
                </button>
              `
            )
            .join("");

          return `
            <div class="chat-message mb-4 ${
              isOwnMessage ? "text-right" : "text-left"
            }">
              <div class="inline-block max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                isOwnMessage
                  ? "bg-indigo-600 text-white"
                  : "bg-gray-100 text-gray-800"
              } shadow-md">
                <div class="text-sm font-medium mb-1 ${
                  isOwnMessage ? "text-indigo-100" : "text-gray-600"
                }">
                  ${message.authorName || "Unknown"} ${
            message.authorRole === "faculty"
              ? "👨‍🏫"
              : message.authorRole === "admin"
              ? "👨‍💼"
              : "👨‍🎓"
          }
                </div>
                ${contentHTML}
                <div class="text-xs mt-1 opacity-75">${formatTimeAgo(
                  message.timestamp
                )}</div>
                <div class="mt-2 flex gap-1">${reactionButtons}</div>
              </div>
            </div>
          `;
        })
        .join("");

      chatMessages.scrollTop = chatMessages.scrollHeight;
    });
  } catch (error) {
    console.error("Error loading chat messages:", error);
    chatMessages.innerHTML = `
      <div class="text-center py-12 text-red-500">
        <div class="text-6xl mb-4">❌</div>
        <p class="text-lg">Error loading messages</p>
      </div>
    `;
  }
}

async function sendMessage() {
  if (!hasPermission("canChat")) {
    showToast("You do not have permission to send messages", "error");
    return;
  }

  const messageInput = document.getElementById("messageInput");
  const fileInput = document.getElementById("fileInput");
  const message = messageInput?.value.trim() || "";

  if (!message && (!fileInput || fileInput.files.length === 0)) return;

  let fileUrl = "";
  let type = "text";

  try {
    if (fileInput && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      // Use guarded uploader if available
      if (window.uploadToImageKit) {
        fileUrl = await window.uploadToImageKit(file);
      } else {
        // fallback: try to upload via existing function name
        fileUrl = await uploadToImageKit(file);
      }
      type = "file";
    }

    await addDoc(collection(db, "messages"), {
      text: message,
      fileUrl: fileUrl || "",
      type: type,
      authorId: currentUser.uid,
      authorName:
        currentUserData?.fullName || currentUserData?.displayName || "Unknown",
      authorRole: currentUserData?.role || "student",
      timestamp: serverTimestamp(),
      reactions: {}, // initialize reactions
    });

    if (messageInput) messageInput.value = "";
    if (fileInput) fileInput.value = "";
  } catch (error) {
    console.error("Error sending message:", error);
    showToast("Failed to send message. Please try again.", "error");
  }
}

// Navigation Functions
function updateNavigation(activeSection) {
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.remove(
      "active",
      "bg-gradient-to-r",
      "from-indigo-500",
      "to-purple-600",
      "text-white"
    );
    item.classList.add("text-gray-700", "hover:bg-gray-50");
  });

  // Add active class to current section
  const activeNavMap = {
    dashboardNav: '[onclick="showDashboard()"]',
    filesNav: '[onclick="showFiles()"]', // changed key
    chatNav: '[onclick="showChat()"]',
    timetableNav: '[onclick="showTimetable()"]',
    pollsNav: '[onclick="showPolls()"]',
    eventsNav: '[onclick="showEvents()"]',
  };

  const selector = activeNavMap[activeSection];
  if (selector) {
    const activeItem = document.querySelector(selector);
    if (activeItem) {
      activeItem.classList.add(
        "active",
        "bg-gradient-to-r",
        "from-indigo-500",
        "to-purple-600",
        "text-white"
      );
      activeItem.classList.remove("text-gray-700", "hover:bg-gray-50");
    }
  }
}

// Enhanced Navigation Functions
function showDashboard() {
  updateNavigation("dashboard");
  const mainContent = document.getElementById("mainContent");

  mainContent.innerHTML = `
    <div class="mb-8">
      <div class="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-8 border border-indigo-200">
        <h1 class="text-3xl font-bold text-gray-800 mb-2">Dashboard Overview</h1>
        <p class="text-gray-600">Welcome to your personalized dashboard</p>
        <div class="mt-4 flex items-center gap-4">
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></span>
            <span>Real-time updates active</span>
          </div>
        </div>
      </div>
    </div>
    
    <div class="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-lg transition-all">
        <div class="flex items-center gap-4">
          <div class="p-3 bg-blue-50 rounded-lg">
            <span class="text-2xl">📚</span>
          </div>
          <div>
            <div class="text-2xl font-bold text-gray-800" id="filesCount">-</div>
            <div class="text-sm text-gray-600">Total Files</div>
          </div>
        </div>
      </div>
      
      <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-lg transition-all">
        <div class="flex items-center gap-4">
          <div class="p-3 bg-green-50 rounded-lg">
            <span class="text-2xl">💬</span>
          </div>
          <div>
            <div class="text-2xl font-bold text-gray-800" id="messagesCount">-</div>
            <div class="text-sm text-gray-600">Chat Messages</div>
          </div>
        </div>
      </div>
      
      <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-lg transition-all">
        <div class="flex items-center gap-4">
          <div class="p-3 bg-purple-50 rounded-lg">
            <span class="text-2xl">👥</span>
          </div>
          <div>
            <div class="text-2xl font-bold text-gray-800" id="usersCount">-</div>
            <div class="text-sm text-gray-600">Total Users</div>
          </div>
        </div>
      </div>
      
      <div class="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-lg transition-all">
        <div class="flex items-center gap-4">
          <div class="p-3 bg-yellow-50 rounded-lg">
            <span class="text-2xl">⚡</span>
          </div>
          <div>
            <div class="text-2xl font-bold text-green-600">Online</div>
            <div class="text-sm text-gray-600">System Status</div>
          </div>
        </div>
      </div>
    </div>
    
    <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">Quick Actions</h2>
      <div class="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        ${
          hasPermission("canViewFiles")
            ? `
          <button onclick="showFiles()" class="flex items-center gap-3 p-4 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors text-left">
            <span class="text-2xl">📚</span>
            <div>
              <div class="font-semibold text-blue-800">View Files</div>
              <div class="text-sm text-blue-600">Access study materials</div>
            </div>
          </button>
        `
            : ""
        }
        
        ${
          hasPermission("canChat")
            ? `
          <button onclick="showChat()" class="flex items-center gap-3 p-4 bg-green-50 hover:bg-green-100 rounded-lg transition-colors text-left">
            <span class="text-2xl">💬</span>
            <div>
              <div class="font-semibold text-green-800">Group Chat</div>
              <div class="text-sm text-green-600">Join the conversation</div>
            </div>
          </button>
        `
            : ""
        }
        
        ${
          hasPermission("canCreateFiles")
            ? `
          <button onclick="showFiles(); setTimeout(() => showUploadModal(), 500)" class="flex items-center gap-3 p-4 bg-purple-50 hover:bg-purple-100 rounded-lg transition-colors text-left">
            <span class="text-2xl">📤</span>
            <div>
              <div class="font-semibold text-purple-800">Upload Files</div>
              <div class="text-sm text-purple-600">Share materials</div>
            </div>
          </button>
        `
            : ""
        }
      </div>
    </div>
  `;

  // Load dashboard stats
  loadDashboardStats();
}

async function loadDashboardStats() {
  try {
    // Count files
    const filesSnapshot = await getDocs(collection(db, "files"));
    document.getElementById("filesCount").textContent = filesSnapshot.size;

    // Count messages
    const messagesSnapshot = await getDocs(
      query(collection(db, "messages"), limit(1000))
    );
    document.getElementById("messagesCount").textContent =
      messagesSnapshot.size;

    // Count users
    const usersSnapshot = await getDocs(collection(db, "users"));
    document.getElementById("usersCount").textContent = usersSnapshot.size;
  } catch (error) {
    console.error("Error loading dashboard stats:", error);
  }
}

// ============== NEW FILE LIBRARY FEATURE ==============

function showFiles() {
  updateNavigation("files");
  showModal("filesModal");
  setupFilesModalContent(); // ✅ add this here
  loadFiles();
}

function setupFilesModalContent() {
  // Create files modal dynamically if it doesn't exist
  let filesModal = document.getElementById("filesModal");
  if (!filesModal) {
    filesModal = document.createElement("div");
    filesModal.id = "filesModal";
    filesModal.className =
      "modal fixed inset-0 flex items-center justify-center";
    filesModal.innerHTML = `
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div class="bg-white rounded-2xl w-full max-w-7xl mx-4 z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-indigo-100 rounded-lg">
              <span class="text-2xl">📚</span>
            </div>
            <div>
              <h2 class="text-xl font-bold text-gray-800">File Library</h2>
              <p class="text-sm text-gray-600">Access academic resources and study materials</p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            ${
              hasPermission("canCreateFiles")
                ? `
              <button onclick="showUploadModal()" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm font-medium">
                📤 Upload File
              </button>
            `
                : ""
            }
            <button onclick="closeModal('filesModal')" class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">
              ✕
            </button>
          </div>
        </div>

        <!-- Search and Filters -->
        <div class="p-6 border-b border-gray-100 bg-gray-50">
          <div class="grid md:grid-cols-3 gap-4">
            <div class="md:col-span-2">
              <div class="relative">
                <span class="absolute left-3 top-3 text-gray-400">🔍</span>
                <input type="text" id="gradesSearch" placeholder="Search files by title, subject, or author..." 
                       class="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
              </div>
            </div>
            <div>
              <select id="courseFilter" class="border rounded-lg p-2">
                  <option>All Courses</option>
                  <option>Electronics</option>
                  <option>Computer Science</option>
                  <option>Electrical Engineering</option>
                  <option>Mechanical Engineering</option>
                  <option>Civil Engineering</option>
                  <option>Information Technology</option>
                  <option>Mathematics</option>
                  <option>Physics</option>
                  <option>Chemistry</option>
                  <option>Biology</option>
                  <option>English</option>
                  <option>History</option>
                  <option>Economics</option>
                  <option>Psychology</option>
                  <option>Philosophy</option>
                  <option>Political Science</option>
                  <option>Business Administration</option>
                  <option>Law</option>  
                  <option>Medicine</option>
                  <option>Architecture</option>
                  <option>Environmental Science</option>
                  <option>Statistics</option>
                  <option>Data Science</option> 
                  <option>Artificial Intelligence</option>
                  <option>Machine Learning</option>
                  <option>Web Development</option>
                  <option>Mobile App Development</option>
                  <option>Game Development</option>
                  <option>Cybersecurity</option>
                  <option>Cloud Computing</option>
                  <option>Networking</option>
                  <option>Robotics</option>
                  <option>Software Engineering</option>
                  <option>Humanities</option>
                  <option>Social Sciences</option>
              </select>
            </div>
          </div>
          <div class="mt-4 flex items-center justify-between">
            <div class="text-sm text-gray-600">
              <span id="filesCount">0</span> files found
            </div>
            <button onclick="clearFilters()" class="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
              Clear Filters
            </button>
          </div>
        </div>

        <!-- Files Grid -->
        <div class="p-6 overflow-y-auto max-h-[calc(90vh-300px)]">
          <div id="filesList" class="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            <!-- Files will be loaded here -->
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(filesModal);

    // ✅ Attach search listener here
    const searchInput = document.getElementById("gradesSearch");
    if (searchInput) {
      searchInput.addEventListener("input", () => loadFiles());
    } else {
      console.warn("❌ gradesSearch not found in DOM");
    }

    // ✅ Attach course filter listener
    const courseFilter = document.getElementById("courseFilter");
    if (courseFilter) {
      courseFilter.addEventListener("change", () => loadFiles());
    }
  }
}

// Load files with real-time updates
async function loadFiles() {
  const filesList = document.getElementById("filesList");
  const filesCount = document.getElementById("filesCount");

  if (!filesList) return;

  try {
    // Show loading state
    filesList.innerHTML = `
      <div class="col-span-full text-center py-12">
        <div class="text-6xl mb-4 animate-pulse">📚</div>
        <p class="text-gray-500">Loading files...</p>
      </div>
    `;

    // Set up real-time listener
    if (filesUnsubscribe) {
      filesUnsubscribe();
    }

    const filesQuery = query(
      collection(db, "files"),
      orderBy("uploadedAt", "desc")
    );

    filesUnsubscribe = onSnapshot(filesQuery, (snapshot) => {
      let files = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Apply filters
      files = applyFilters(files);

      // Update count
      if (filesCount) {
        filesCount.textContent = files.length;
      }

      // Render files
      renderFiles(files);

      // Populate course filter
      populateCourseFilter(snapshot.docs.map((doc) => doc.data()));
    });
  } catch (error) {
    console.error("Error loading files:", error);
    if (filesList) {
      filesList.innerHTML = `
        <div class="col-span-full text-center py-12">
          <div class="text-6xl mb-4">⚠️</div>
          <p class="text-red-500">Error loading files</p>
          <button onclick="loadFiles()" class="mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">
            Try Again
          </button>
        </div>
      `;
    }
  }
}

// Apply search and course filters
function applyFilters(files) {
  const searchTerm =
    document.getElementById("gradesSearch")?.value.toLowerCase() || "";
  const courseFilter = document.getElementById("courseFilter")?.value || "";

  let filteredFiles = files;

  if (searchTerm) {
    filteredFiles = filteredFiles.filter(
      (file) =>
        file.title?.toLowerCase().includes(searchTerm) ||
        file.subject?.toLowerCase().includes(searchTerm) ||
        file.course?.toLowerCase().includes(searchTerm) ||
        file.authorName?.toLowerCase().includes(searchTerm)
    );
  }

  if (courseFilter) {
    filteredFiles = filteredFiles.filter(
      (file) => file.course === courseFilter
    );
  }

  return filteredFiles;
}

// Render files grid
function renderFiles(files) {
  const filesList = document.getElementById("filesList");
  if (!filesList) return;

  if (files.length === 0) {
    filesList.innerHTML = `
      <div class="col-span-full text-center py-12">
        <div class="text-6xl mb-4">📚</div>
        <p class="text-gray-500">No files found</p>
        ${
          hasPermission("canCreateFiles")
            ? '<p class="text-sm text-gray-400 mt-2">Upload the first file to get started!</p>'
            : ""
        }
      </div>
    `;
    return;
  }

  filesList.innerHTML = files
    .map(
      (file) => `
    <div class="file-card bg-white border border-gray-200 rounded-xl p-4 hover:border-indigo-300 hover:shadow-lg transition-all"
         data-title="${(file.title || "Untitled").toLowerCase()}"
         data-description="${(file.description || "").toLowerCase()}"
         data-subject="${(file.subject || "").toLowerCase()}"
         data-course="${(file.course || "").toLowerCase()}"
         data-author="${(file.authorName || "Unknown").toLowerCase()}">

      <!-- File Icon and Type -->
      <div class="flex items-center justify-between mb-3">
        <div class="text-3xl">${getFileIcon(file.fileName)}</div>
        <span class="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded uppercase font-medium">
          ${getFileExtension(file.fileName)}
        </span>
      </div>

      <!-- File Info -->
      <h3 class="file-title font-semibold text-gray-800 mb-2 line-clamp-2 text-sm">
        ${file.title || "Untitled"}
      </h3>
      <p class="file-description text-xs text-gray-600 mb-3 line-clamp-2">
        ${file.description || "No description"}
      </p>

      <!-- Metadata -->
      <div class="space-y-1 mb-4">
        ${
          file.subject
            ? `
          <div class="file-subject flex items-center gap-2 text-xs">
            <span class="w-2 h-2 bg-indigo-500 rounded-full"></span>
            <span class="font-medium text-indigo-700">${file.subject}</span>
          </div>
        `
            : ""
        }
        ${
          file.course
            ? `
          <div class="file-course flex items-center gap-2 text-xs text-gray-600">
            <span class="w-2 h-2 bg-gray-400 rounded-full"></span>
            <span>${file.course}</span>
          </div>
        `
            : ""
        }
        <div class="file-author text-xs text-gray-500">
          <div>📁 ${file.fileSize || "Unknown size"}</div>
          <div>👤 ${file.authorName || "Unknown"}</div>
          <div>📅 ${formatTimeAgo(file.uploadedAt)}</div>
          <div>📥 ${file.downloads || 0} downloads</div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex gap-2">
        <button onclick="previewFile('${file.id}', '${file.fileUrl}', '${
        file.fileType || ""
      }')" 
                class="flex-1 bg-gray-50 text-gray-700 py-2 px-3 rounded-lg text-xs font-medium hover:bg-gray-100 transition-colors">
          👁️ Preview
        </button>
        <button onclick="downloadFile('${file.id}', '${file.fileUrl}', '${
        file.fileName || "download"
      }')" 
                class="flex-1 bg-indigo-50 text-indigo-600 py-2 px-3 rounded-lg text-xs font-medium hover:bg-indigo-100 transition-colors">
          📥 Download
        </button>
        ${
          (hasPermission("canDeleteFiles") &&
            file.authorId === currentUser?.uid) ||
          hasPermission("canDeleteAnyContent")
            ? `
          <button onclick="deleteFile('${file.id}', '${
                file.title || "this file"
              }')" 
                  class="bg-red-50 text-red-600 py-2 px-3 rounded-lg text-xs font-medium hover:bg-red-100 transition-colors">
            🗑️
          </button>
        `
            : ""
        }
      </div>
    </div>
  `
    )
    .join("");
}

// Populate course filter dropdown
function populateCourseFilter(files) {
  const courseFilter = document.getElementById("courseFilter");
  if (!courseFilter) return;

  const courses = [
    ...new Set(files.map((file) => file.course).filter(Boolean)),
  ].sort();

  // Keep "All Courses" option and add unique courses
  const currentValue = courseFilter.value;
  courseFilter.innerHTML = '<option value="">All Courses</option>';

  courses.forEach((course) => {
    const option = document.createElement("option");
    option.value = course;
    option.textContent = course;
    courseFilter.appendChild(option);
  });

  courseFilter.value = currentValue;
}

// Show upload modal
function showUploadModal() {
  if (!hasPermission("canCreateFiles")) {
    showToast("You do not have permission to upload files", "error");
    return;
  }

  createUploadModal();
}

// Create upload modal
function createUploadModal() {
  // Remove existing modal if present
  const existingModal = document.getElementById("uploadModal");
  if (existingModal) {
    existingModal.remove();
  }

  const uploadModalHTML = `
    <div id="uploadModal" 
         style="position:fixed;top:0;left:0;right:0;bottom:0;z-index:999999;"
         class="modal inset-0 show overflow-y-auto flex justify-center items-start py-10">
      
      <!-- Backdrop -->
      <div style="position:absolute;top:0;left:0;right:0;bottom:0;z-index:999999;background-color:rgba(0,0,0,0.5);backdrop-filter:blur(4px);" 
           onclick="closeModal('uploadModal')"></div>
      
      <!-- Modal Content -->
      <div style="z-index:1000000;"
           class="bg-white rounded-2xl w-full max-w-2xl mx-4 shadow-2xl max-h-[90vh] overflow-y-auto">
        
        <!-- Header -->
        <div class="flex items-center justify-between p-6 border-b border-gray-200 bg-gradient-to-r from-indigo-50 to-purple-50">
          <div class="flex items-center gap-3">
            <div class="p-2 bg-indigo-100 rounded-lg">
              <span class="text-2xl">📤</span>
            </div>
            <div>
              <h2 class="text-xl font-bold text-gray-800">Upload File</h2>
              <p class="text-sm text-gray-600">Share academic resources with students</p>
            </div>
          </div>
          <button onclick="closeModal('uploadModal')" 
                  class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">
            ✕
          </button>
        </div>

        <!-- Form Content -->
        <div class="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
          <form id="uploadForm" class="space-y-6">
            <!-- File Upload Area -->
            <div class="space-y-2">
              <label class="block text-sm font-semibold text-gray-700">Select File *</label>
              <div id="dropZone" class="border-2 border-dashed border-indigo-300 rounded-xl p-8 text-center hover:border-indigo-400 transition-colors cursor-pointer bg-indigo-50/50">
                <div id="dropContent">
                  <div class="text-6xl mb-4">📁</div>
                  <div class="text-lg font-medium text-gray-700 mb-2">Drop files here or click to browse</div>
                  <div class="text-sm text-gray-500 mb-4">Supports PDF, DOC, DOCX, PPT, PPTX, TXT, Images (Max: 50MB)</div>
                  <button type="button" class="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 transition-colors">
                    Choose Files
                  </button>
                </div>
                <div id="filePreview" class="hidden">
                  <div class="flex items-center justify-center gap-3 p-4 bg-white rounded-lg border">
                    <span id="fileIcon" class="text-3xl"></span>
                    <div class="text-left flex-1">
                      <div id="fileName" class="font-medium text-gray-800"></div>
                      <div id="fileSize" class="text-sm text-gray-500"></div>
                    </div>
                    <button type="button" onclick="clearFile()" class="text-red-500 hover:text-red-700 transition-colors">
                      🗑️
                    </button>
                  </div>
                </div>
              </div>
              <input type="file" id="fileInput" class="hidden" 
                     accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.xls,.xlsx,.jpg,.jpeg,.png,.mp4,.mp3">
            </div>

            <!-- File Details -->
            <div class="grid md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <label for="fileTitle" class="block text-sm font-semibold text-gray-700">Title *</label>
                <input type="text" id="fileTitle" name="fileTitle" required
                       class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                       placeholder="Enter file title">
              </div>
              
              <div class="space-y-2">
                <label for="fileSubject" class="block text-sm font-semibold text-gray-700">Subject *</label>
                <select id="fileSubject" name="fileSubject" required
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                  <option value="">Select Subject</option>
                  <option value="Computer Science">Computer Science</option>
                  <option value="Mathematics">Mathematics</option>
                  <option value="Physics">Physics</option>
                  <option value="Chemistry">Chemistry</option>
                  <option value="Electronics">Electronics</option>
                  <option value="Mechanical Engineering">Mechanical Engineering</option>
                  <option value="Civil Engineering">Civil Engineering</option>
                  <option value="Electrical Engineering">Electrical Engineering</option>
                  <option value="English">English</option>
                  <option value="Business Studies">Business Studies</option>
                  <option value="Economics">Economics</option>
                  <option value="Statistics">Statistics</option>
                  <option value="Data Structures">Data Structures</option>
                  <option value="Database Management">Database Management</option>
                  <option value="Web Development">Web Development</option>
                  <option value="Machine Learning">Machine Learning</option>
                  <option value="Operating Systems">Operating Systems</option>
                  <option value="Other">Other</option>
                </select>
              </div>
            </div>

            <div class="space-y-2">
              <label for="fileDescription" class="block text-sm font-semibold text-gray-700">Description</label>
              <textarea id="fileDescription" name="fileDescription" rows="3"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
                        placeholder="Brief description about the content (optional)"></textarea>
            </div>

            <!-- Course & Year -->
            <div class="grid md:grid-cols-2 gap-4">
              <div class="space-y-2">
                <label for="fileCourse" class="block text-sm font-semibold text-gray-700">Course</label>
                <select id="fileCourse" name="fileCourse"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                  <option value="">Select Course</option>
                  <option value="BCA">BCA</option>
                  <option value="MCA">MCA</option>
                  <option value="BTech Computer Science">BTech Computer Science</option>
                  <option value="BTech Electronics">BTech Electronics</option>
                  <option value="BTech Mechanical">BTech Mechanical</option>
                  <option value="BTech Civil">BTech Civil</option>
                  <option value="BTech Electrical">BTech Electrical</option>
                  <option value="BSc Computer Science">BSc Computer Science</option>
                  <option value="BSc Mathematics">BSc Mathematics</option>
                  <option value="BSc Physics">BSc Physics</option>
                  <option value="BCom">BCom</option>
                  <option value="MCom">MCom</option>
                  <option value="BBA">BBA</option>
                  <option value="MBA">MBA</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              
              <div class="space-y-2">
                <label for="fileYear" class="block text-sm font-semibold text-gray-700">Academic Year</label>
                <select id="fileYear" name="fileYear"
                        class="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-transparent">
                  <option value="">Select Year</option>
                  <option value="1st Year">1st Year</option>
                  <option value="2nd Year">2nd Year</option>
                  <option value="3rd Year">3rd Year</option>
                  <option value="4th Year">4th Year</option>
                </select>
              </div>
            </div>

            <!-- Upload Progress -->
            <div id="uploadProgress" class="hidden">
              <div class="space-y-2">
                <div class="flex items-center justify-between text-sm">
                  <span class="text-gray-600">Upload Progress</span>
                  <span id="uploadPercentage" class="font-medium text-indigo-600">0%</span>
                </div>
                <div class="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div id="uploadProgressBar" class="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300 ease-out" style="width: 0%"></div>
                </div>
                <div id="uploadStatus" class="text-sm text-gray-600">Preparing upload...</div>
              </div>
            </div>
          </form>
        </div>

        <!-- Footer -->
        <div class="flex items-center justify-between p-6 border-t border-gray-200 bg-gray-50">
          <div class="text-sm text-gray-500">
            <span class="inline-flex items-center gap-1">
              ⚠️ Maximum file size: 50MB
            </span>
          </div>
          <div class="flex gap-3">
            <button type="button" onclick="closeModal('uploadModal')"
                    class="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" form="uploadForm" id="uploadBtn"
                    class="px-6 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
              <span id="uploadBtnText">Upload File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", uploadModalHTML);
  initializeUploadModal();
}

// Initialize upload modal functionality
function initializeUploadModal() {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("fileInput");
  const uploadForm = document.getElementById("uploadForm");

  // File input handling
  dropZone.addEventListener("click", (e) => {
    if (e.target.closest("#filePreview")) return;
    fileInput.click();
  });

  fileInput.addEventListener("change", handleFileSelect);

  // Drag and drop
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("border-indigo-500", "bg-indigo-100");
  });

  dropZone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-indigo-500", "bg-indigo-100");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("border-indigo-500", "bg-indigo-100");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      fileInput.files = files;
      handleFileSelect({ target: { files } });
    }
  });

  // Form submission
  uploadForm.addEventListener("submit", handleFileUploadSubmit);

  // Auto-detect title and subject from filename
  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      const file = fileInput.files[0];
      const titleInput = document.getElementById("fileTitle");
      const subjectSelect = document.getElementById("fileSubject");

      if (!titleInput.value) {
        const fileName = file.name.replace(/\.[^/.]+$/, "");
        titleInput.value = fileName.charAt(0).toUpperCase() + fileName.slice(1);
      }

      if (!subjectSelect.value) {
        const detectedSubject = detectSubjectFromFilename(file.name);
        if (detectedSubject !== "Other") {
          subjectSelect.value = detectedSubject;
        }
      }
    }
  });
}

// Handle file selection
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  // Validate file size (50MB)
  if (file.size > 50 * 1024 * 1024) {
    showToast("File size exceeds 50MB limit", "error");
    clearFile();
    return;
  }

  // Show file preview
  const dropContent = document.getElementById("dropContent");
  const filePreview = document.getElementById("filePreview");
  const fileName = document.getElementById("fileName");
  const fileSize = document.getElementById("fileSize");
  const fileIcon = document.getElementById("fileIcon");

  dropContent.classList.add("hidden");
  filePreview.classList.remove("hidden");

  fileName.textContent = file.name;
  fileSize.textContent = formatFileSize(file.size);
  fileIcon.textContent = getFileIcon(file.name);
}

// Clear selected file
function clearFile() {
  const fileInput = document.getElementById("fileInput");
  const dropContent = document.getElementById("dropContent");
  const filePreview = document.getElementById("filePreview");

  if (fileInput) fileInput.value = "";
  if (dropContent) dropContent.classList.remove("hidden");
  if (filePreview) filePreview.classList.add("hidden");
}

// Handle file upload submission
async function handleFileUploadSubmit(e) {
  e.preventDefault();

  if (!hasPermission("canCreateFiles")) {
    showToast("You do not have permission to upload files", "error");
    return;
  }

  const formData = new FormData(e.target);
  const file = document.getElementById("fileInput").files[0];

  if (!file) {
    showToast("Please select a file to upload", "error");
    return;
  }

  // Validate required fields
  const title = formData.get("fileTitle")?.trim();
  const subject = formData.get("fileSubject");

  if (!title || !subject) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  try {
    // Show progress
    showUploadProgress(true);
    const uploadBtn = document.getElementById("uploadBtn");
    uploadBtn.disabled = true;

    // Upload to ImageKit
    const result = await uploadToImageKit(file);

    if (result && result.url) {
      // Save file metadata to Firestore
      const fileData = {
        title: title,
        subject: subject,
        description: formData.get("fileDescription") || "",
        course: formData.get("fileCourse") || "",
        year: formData.get("fileYear") || "",
        fileName: file.name,
        fileSize: formatFileSize(file.size),
        fileUrl: result.url,
        fileType: file.type,
        publicId: result.fileId,
        authorId: currentUser.uid,
        authorName:
          currentUserData?.fullName ||
          currentUserData?.displayName ||
          "Unknown",
        authorRole: currentUserData?.role || "faculty",
        uploadedAt: serverTimestamp(),
        downloads: 0,
        views: 0,
      };

      await addDoc(collection(db, "files"), fileData);

      // Success feedback
      showToast("File uploaded successfully!", "success");
      closeModal("uploadModal");

      // Files will auto-refresh due to real-time listener
    } else {
      throw new Error("Upload failed - no URL returned");
    }
  } catch (error) {
    console.error("Upload error:", error);
    showToast(`Upload failed: ${error.message}`, "error");
  } finally {
    showUploadProgress(false);
    const uploadBtn = document.getElementById("uploadBtn");
    if (uploadBtn) uploadBtn.disabled = false;
  }
}

// --- NEW: Upload file to ImageKit.io ---
async function uploadToImageKit(file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("fileName", file.name);

  // Optionally add other fields as needed:
  // formData.append("subject", document.getElementById("fileSubject").value);
  // formData.append("course", document.getElementById("fileCourse").value);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) {
        const percentComplete = Math.round((e.loaded / e.total) * 100);
        updateUploadProgress(percentComplete);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch (e) {
          reject(new Error("Invalid response format"));
        }
      } else {
        try {
          const error = JSON.parse(xhr.responseText);
          reject(
            new Error(
              error.error ||
                error.message ||
                `Upload failed with status ${xhr.status}`
            )
          );
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.open("POST", "http://localhost:3000/api/upload");
    xhr.send(formData);
  });
}

// Show/hide upload progress
function showUploadProgress(show) {
  const progressEl = document.getElementById("uploadProgress");
  const uploadBtnText = document.getElementById("uploadBtnText");

  if (progressEl && uploadBtnText) {
    if (show) {
      progressEl.classList.remove("hidden");
      uploadBtnText.textContent = "Uploading...";
    } else {
      progressEl.classList.add("hidden");
      uploadBtnText.textContent = "Upload File";
      updateUploadProgress(0);
    }
  }
}

// Update upload progress
function updateUploadProgress(percentage) {
  const progressBar = document.getElementById("uploadProgressBar");
  const percentageEl = document.getElementById("uploadPercentage");
  const statusEl = document.getElementById("uploadStatus");

  if (progressBar) progressBar.style.width = `${percentage}%`;
  if (percentageEl) percentageEl.textContent = `${percentage}%`;

  if (statusEl) {
    if (percentage === 0) {
      statusEl.textContent = "Preparing upload...";
    } else if (percentage < 100) {
      statusEl.textContent = "Uploading file...";
    } else {
      statusEl.textContent = "Processing and saving...";
    }
  }
}

// Preview file
async function previewFile(fileId, fileUrl, fileType) {
  try {
    // Only increment view count if user is faculty/admin
    const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
    const role = userDoc.data().role;

    if (fileId && (role === "faculty" || role === "admin")) {
      const fileRef = doc(db, "files", fileId);
      const fileSnap = await getDoc(fileRef);
      if (fileSnap.exists()) {
        await updateDoc(fileRef, {
          views: (fileSnap.data().views || 0) + 1,
        });
      }
    }

    // Create preview modal
    createPreviewModal(fileUrl, fileType);
  } catch (error) {
    console.error("Preview error:", error);
    showToast("Preview failed. Opening in new tab...", "warning");
    window.open(fileUrl, "_blank");
  }
}

// Create preview modal
function createPreviewModal(fileUrl, fileType) {
  // Remove existing preview modal
  const existingPreview = document.getElementById("previewModal");
  if (existingPreview) existingPreview.remove();

  const previewModalHTML = `
    <div id="previewModal" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
      <div class="bg-white rounded-lg w-full max-w-5xl mx-4 h-[85vh] flex flex-col">
        <div class="flex items-center justify-between p-4 border-b">
          <h3 class="text-lg font-semibold">File Preview</h3>
          <div class="flex gap-2">
            <a href="${fileUrl}" target="_blank" 
               class="px-3 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 text-sm">
              🔗 Open in New Tab
            </a>
            <button onclick="document.getElementById('previewModal').remove()" 
                    class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200">
              ✕
            </button>
          </div>
        </div>
        <div class="flex-1 p-4">
          ${getPreviewContent(fileUrl, fileType)}
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", previewModalHTML);
}

// Get preview content based on file type
function getPreviewContent(fileUrl, fileType) {
  const fileName = fileUrl.split("/").pop();

  if (fileType?.includes("pdf") || fileName.toLowerCase().endsWith(".pdf")) {
    return `<iframe src="${fileUrl}" class="w-full h-full rounded" frameborder="0"></iframe>`;
  } else if (
    fileType?.includes("image") ||
    /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(fileName)
  ) {
    return `<img src="${fileUrl}" class="max-w-full max-h-full object-contain mx-auto" alt="Preview">`;
  } else if (
    fileType?.includes("video") ||
    /\.(mp4|webm|ogg|mov)$/i.test(fileName)
  ) {
    return `
      <video controls class="w-full h-full max-h-96 mx-auto">
        <source src="${fileUrl}" type="${fileType || "video/mp4"}">
        Your browser does not support the video tag.
      </video>
    `;
  } else if (
    fileType?.includes("audio") ||
    /\.(mp3|wav|ogg|m4a)$/i.test(fileName)
  ) {
    return `
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <div class="text-6xl mb-4">🎵</div>
          <audio controls class="mb-4">
            <source src="${fileUrl}" type="${fileType || "audio/mpeg"}">
            Your browser does not support the audio tag.
          </audio>
          <p class="text-gray-600">Audio Preview</p>
        </div>
      </div>
    `;
  } else {
    return `
      <div class="flex items-center justify-center h-full">
        <div class="text-center">
          <div class="text-6xl mb-4">${getFileIcon(fileName)}</div>
          <p class="text-gray-600 mb-4">Preview not available for this file type</p>
          <a href="${fileUrl}" target="_blank" 
             class="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700">
            🔗 Open in New Tab
          </a>
        </div>
      </div>
    `;
  }
}

// Download file
async function downloadFile(fileId, fileUrl, fileName) {
  if (!hasPermission("canDownloadFiles")) {
    showToast("You do not have permission to download files", "error");
    return;
  }

  try {
    // Check user role
    const userDoc = await getDoc(doc(db, "users", auth.currentUser.uid));
    const role = userDoc.data().role;

    // Increment download count ONLY for faculty/admin
    if (fileId && (role === "faculty" || role === "admin")) {
      const fileRef = doc(db, "files", fileId);
      const fileSnap = await getDoc(fileRef);
      if (fileSnap.exists()) {
        await updateDoc(fileRef, {
          downloads: (fileSnap.data().downloads || 0) + 1,
        });
      }
    }

    // Download the file via ImageKit
    const link = document.createElement("a");
    link.href = fileUrl;
    link.download = fileName || "download";
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast(`Downloading ${fileName}...`, "success");
  } catch (error) {
    console.error("Download error:", error);
    showToast("Download failed. Please try again.", "error");
    // Open directly in new tab as fallback
    window.open(fileUrl, "_blank");
  }
}

// Delete file
async function deleteFile(fileId, fileName) {
  if (
    !hasPermission("canDeleteFiles") &&
    !hasPermission("canDeleteAnyContent")
  ) {
    showToast("You do not have permission to delete files", "error");
    return;
  }

  if (
    !confirm(
      `Are you sure you want to delete "${fileName}"? This action cannot be undone.`
    )
  ) {
    return;
  }

  try {
    const fileRef = doc(db, "files", fileId);
    const fileSnap = await getDoc(fileRef);

    if (fileSnap.exists()) {
      const fileData = fileSnap.data();

      // Check permissions
      if (
        fileData.authorId !== currentUser?.uid &&
        !hasPermission("canDeleteAnyContent")
      ) {
        showToast("You can only delete your own files", "error");
        return;
      }

      // Delete from Firestore
      await deleteDoc(fileRef);
      showToast("File deleted successfully", "success");

      // Note: Cloudinary file deletion would require backend API
      // For now, we'll just delete the database entry
    } else {
      showToast("File not found", "error");
    }
  } catch (error) {
    console.error("Delete error:", error);
    showToast("Failed to delete file. Please try again.", "error");
  }
}

// Clear all filters
function clearFilters() {
  const searchInput = document.getElementById("gradesSearch");
  const courseFilter = document.getElementById("courseFilter");

  if (searchInput) searchInput.value = "";
  if (courseFilter) courseFilter.value = "";

  // Reload files will happen automatically via real-time listener
  loadFiles();
}

// Filter files based on search and course
function filterFiles() {
  console.log("✅ filterFiles triggered");

  const searchInput = document.getElementById("gradesSearch");
  const courseFilter = document.getElementById("courseFilter");
  const gradesCourseFilter = document.getElementById("gradesCourseFilter");
  const fileCards = document.querySelectorAll(".file-card");

  const searchText = searchInput?.value.toLowerCase() || "";
  const selectedCourse = courseFilter?.value.toLowerCase() || "";
  const selectedGradeCourse = gradesCourseFilter?.value.toLowerCase() || "";

  fileCards.forEach((card) => {
    const title = card.dataset.title || "";
    const course = card.dataset.course || "";

    // ✅ Only search in file title
    const matchesSearch = title.includes(searchText);

    // ✅ Apply both filters
    const matchesCourse =
      !selectedCourse ||
      selectedCourse === "all sections" ||
      course.includes(selectedCourse);

    const matchesGradeCourse =
      !selectedGradeCourse ||
      selectedGradeCourse === "all courses" ||
      course.includes(selectedGradeCourse);

    // ✅ Show card if it matches search AND filters
    card.style.display =
      matchesSearch && matchesCourse && matchesGradeCourse ? "block" : "none";
  });
}

// Utility functions for file handling
function getFileIcon(fileName) {
  if (!fileName) return "📄";

  const extension = fileName.toLowerCase().split(".").pop();

  switch (extension) {
    case "pdf":
      return "📄";
    case "doc":
    case "docx":
      return "📝";
    case "ppt":
    case "pptx":
      return "📊";
    case "xls":
    case "xlsx":
      return "📈";
    case "txt":
      return "📃";
    case "jpg":
    case "jpeg":
    case "png":
    case "gif":
    case "bmp":
    case "webp":
      return "🖼️";
    case "mp4":
    case "avi":
    case "mov":
    case "wmv":
      return "🎥";
    case "mp3":
    case "wav":
    case "ogg":
    case "m4a":
      return "🎵";
    case "zip":
    case "rar":
    case "7z":
      return "🗜️";
    default:
      return "📎";
  }
}

function getFileExtension(fileName) {
  if (!fileName) return "FILE";
  return fileName.split(".").pop().toUpperCase();
}

function detectSubjectFromFilename(filename) {
  const name = filename.toLowerCase();

  const subjectPatterns = {
    "Computer Science": [
      "computer",
      "programming",
      "coding",
      "software",
      "algorithm",
      "data structure",
      "cs",
      "java",
      "python",
      "javascript",
    ],
    Mathematics: [
      "math",
      "calculus",
      "algebra",
      "geometry",
      "trigonometry",
      "statistics",
      "probability",
    ],
    Physics: [
      "physics",
      "mechanics",
      "thermodynamics",
      "electromagnetism",
      "quantum",
      "optics",
    ],
    Chemistry: [
      "chemistry",
      "organic",
      "inorganic",
      "physical chemistry",
      "analytical",
    ],
    Electronics: [
      "electronics",
      "circuits",
      "digital",
      "analog",
      "vlsi",
      "embedded",
    ],
    "Database Management": [
      "database",
      "dbms",
      "sql",
      "mysql",
      "oracle",
      "mongodb",
    ],
    "Web Development": [
      "web",
      "html",
      "css",
      "react",
      "angular",
      "vue",
      "node",
    ],
    "Machine Learning": [
      "machine learning",
      "ml",
      "ai",
      "neural",
      "deep learning",
    ],
    "Operating Systems": ["operating system", "os", "linux", "windows", "unix"],
    English: ["english", "grammar", "literature", "communication"],
    "Business Studies": ["business", "management", "marketing", "finance"],
    Economics: ["economics", "micro", "macro", "economic"],
  };

  for (const [subject, keywords] of Object.entries(subjectPatterns)) {
    if (keywords.some((keyword) => name.includes(keyword))) {
      return subject;
    }
  }

  return "Other";
}

// ============== END FILE LIBRARY FEATURE ==============
// Initialize persistent chat state
if (!window.persistentChatState) {
  window.persistentChatState = {
    messages: new Map(),
    onlineUsers: new Map(),
    typingUsers: new Set(),
    isConnected: true,
    messageIdCounter: 1,
    initialized: false,
  };
}

/* -------------------- Toast -------------------- */
function showToast(message, type = "info", duration = 3000) {
  // Create toast notification
  const toast = document.createElement("div");
  toast.className = `fixed top-4 right-4 z-[10000] px-6 py-3 rounded-lg shadow-lg text-white font-medium transform transition-all duration-300 translate-x-full`;

  const colors = {
    success: "bg-green-500",
    error: "bg-red-500",
    info: "bg-blue-500",
    warning: "bg-yellow-500",
  };

  toast.classList.add(colors[type] || colors.info);
  toast.textContent = message;

  document.body.appendChild(toast);

  // Animate in
  requestAnimationFrame(() => {
    toast.style.transform = "translateX(0)";
  });

  // Remove after duration
  setTimeout(() => {
    toast.style.transform = "translateX(100%)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

/* -------------------- Show Chat (Modal) -------------------- */
function showChat() {
  // Mock permission check - replace with your actual permission logic
  const hasPermission = (permission) => true;

  if (!hasPermission("canChat")) {
    showToast("You do not have permission to access chat", "error");
    return;
  }

  // Mock user data - replace with your actual user data
  const mockCurrentUser = { uid: "user1" };
  const mockCurrentUserData = { fullName: "John Doe", displayName: "John" };

  window.currentUser = window.currentUser || mockCurrentUser;
  window.currentUserData = window.currentUserData || mockCurrentUserData;

  // Remove any existing chat modal
  document.getElementById("chatModal")?.remove();

  // Get user info
  const userRole =
    new URLSearchParams(window.location.search).get("role") || "student";
  const userName =
    window.currentUserData?.fullName ||
    window.currentUserData?.displayName ||
    "Anonymous";
  const userInitials = userName
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  // Create professional chat modal
  const chatModalHTML = `
    <div id="chatModal" class="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fadeIn">
      <div class="bg-white rounded-2xl w-full max-w-6xl h-[90vh] shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
        
        <!-- Header -->
        <div class="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-600 to-indigo-700 text-white">
          <div class="flex items-center gap-4">
            <div class="relative">
              <div class="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center text-2xl backdrop-blur-sm">💬</div>
              <div id="connectionStatus" class="absolute -top-1 -right-1 w-4 h-4 bg-green-400 rounded-full border-2 border-white animate-pulse"></div>
            </div>
            <div>
              <h2 class="text-xl font-bold">Professional Group Chat</h2>
              <div class="flex items-center gap-3 text-white/80 text-sm">
                <span id="onlineCount">0 members online</span>
                <span>•</span>
                <span id="connectionText">Connected</span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button id="chatSettingsBtn" class="p-2 hover:bg-white/10 rounded-lg transition-colors" title="Settings" aria-label="Settings">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd"/></svg>
            </button>
            <button id="closeChatModal" class="p-2 hover:bg-red-500/20 rounded-lg transition-colors" title="Close" aria-label="Close">
              <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
            </button>
          </div>
        </div>
        
        <!-- Main Content -->
        <div class="flex flex-1 min-h-0">
          
          <!-- Online Users Sidebar -->
          <div class="w-80 bg-gray-50 border-r border-gray-200 flex flex-col">
            <div class="p-4 border-b border-gray-200">
              <h3 class="font-semibold text-gray-900 flex items-center gap-2">
                <div class="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                Online Members
              </h3>
            </div>
            <div id="onlineUsersList" class="flex-1 p-4 overflow-y-auto space-y-2"></div>
          </div>
          
          <!-- Chat Area -->
          <div class="flex-1 flex flex-col bg-white relative">
            
            <!-- Messages Container -->
            <div id="messagesContainer" class="flex-1 overflow-y-auto p-6 space-y-4">
              <div class="flex justify-center py-8">
                <div class="flex items-center gap-3 px-6 py-3 bg-gray-100 rounded-xl">
                  <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                  <span class="text-gray-600">Loading messages...</span>
                </div>
              </div>
            </div>
            
            <!-- Typing Indicators -->
            <div id="typingIndicators" class="px-6 py-2 min-h-[40px]"></div>
            
            <!-- Message Input -->
            <div class="p-6 bg-gray-50 border-t border-gray-200">
              <div class="flex items-end gap-3">
                <div class="flex-1 relative">
                  <textarea
                    id="messageInput"
                    placeholder="Type your message... (Press Enter to send, Shift+Enter for new line)"
                    class="w-full px-4 py-3 pr-20 bg-white border border-gray-300 rounded-xl text-gray-900 placeholder-gray-500 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-200 max-h-32"
                    rows="1"
                  ></textarea>
                  <div class="absolute right-2 top-1/2 -translate-y-1/2 transform flex gap-1">
                    <button id="emojiBtn" class="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600 relative" title="Emoji">😊</button>
                    <input type="file" id="fileInput" class="hidden" />
<label for="fileInput" id="attachBtn"  class="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-400 hover:text-gray-600" title="Attach">📎</label>
                  </div>
                </div>
                <button
                  id="sendMessageBtn"
                  class="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl text-white font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  disabled
                >
                  <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z"/></svg>
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Add to DOM
  document.body.insertAdjacentHTML("beforeend", chatModalHTML);

  // Add custom styles
  addChatStyles();

  // Initialize chat functionality
  initializeProfessionalChat();
}

/* -------------------- Styles -------------------- */
function addChatStyles() {
  if (document.getElementById("professionalChatStyles")) return;

  const styles = document.createElement("style");
  styles.id = "professionalChatStyles";
  styles.textContent = `
    @keyframes fadeIn { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } }
    @keyframes slideInFromRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes slideInFromLeft { from { opacity: 0; transform: translateX(-20px); } to { opacity: 1; transform: translateX(0); } }
    @keyframes typing { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-3px); opacity: 1; } }
    .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
    .animate-slideInFromRight { animation: slideInFromRight 0.3s ease-out; }
    .animate-slideInFromLeft { animation: slideInFromLeft 0.3s ease-out; }

    .typing-dot { width: 4px; height: 4px; border-radius: 50%; background: #6b7280; display: inline-block; animation: typing 1.4s infinite ease-in-out; }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }

    #messagesContainer::-webkit-scrollbar { width: 6px; }
    #messagesContainer::-webkit-scrollbar-track { background: #f3f4f6; }
    #messagesContainer::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }
    #messagesContainer::-webkit-scrollbar-thumb:hover { background: #9ca3af; }

    .message-bubble { max-width: 70%; word-wrap: break-word; }
    .message-reactions { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
    .reaction-button { display: inline-flex; align-items: center; gap: 2px; padding: 2px 6px; background: #f3f4f6; border: 1px solid #e5e7eb; border-radius: 12px; font-size: 12px; cursor: pointer; transition: all 0.2s; }
    .reaction-button:hover { background: #e5e7eb; }
    .reaction-button.active { background: #dbeafe; border-color: #3b82f6; color: #1d4ed8; }

    /* Fixed emoji picker positioning */
    .professional-emoji-picker {
      position: fixed !important;
      z-index: 10001 !important;
      background: white;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05);
      padding: 12px;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 8px;
      max-width: 250px;
    }
    .professional-emoji-picker button {
      width: 32px; height: 32px; border: none; background: none; border-radius: 8px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; font-size: 18px;
    }
    .professional-emoji-picker button:hover { background: #f3f4f6; transform: scale(1.1); }

    /* Message action buttons */
    .message-actions {
      position: absolute; top: -40px; display: flex; gap: 4px; background: white; border: 1px solid #e5e7eb; border-radius: 8px; padding: 4px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
      opacity: 0; transform: translateY(8px); transition: all 0.2s; z-index: 1000;
    }
    .message-container:hover .message-actions { opacity: 1; transform: translateY(0); }
    .message-action-btn { width: 28px; height: 28px; border: none; background: white; border-radius: 6px; cursor: pointer; transition: all 0.2s; display: flex; align-items: center; justify-content: center; font-size: 14px; }
    .message-action-btn:hover { background: #f3f4f6; transform: scale(1.05); }

    /* Context menu */
    .context-menu {
      position: fixed; background: white; border: 1px solid #e5e7eb; border-radius: 8px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.1);
      padding: 4px 0; z-index: 10002; min-width: 160px;
    }
    .context-menu button {
      width: 100%; text-align: left; padding: 8px 12px; border: none; background: none; cursor: pointer; transition: background-color 0.2s; font-size: 14px; color: #374151;
    }
    .context-menu button:hover { background: #f3f4f6; }
  `;
  document.head.appendChild(styles);
}

/* -------------------- Initialization (Single Definition) -------------------- */
function initializeProfessionalChat() {
  const messageInput = document.getElementById("messageInput");
  const sendBtn = document.getElementById("sendMessageBtn");
  const closeBtn = document.getElementById("closeChatModal");
  const emojiBtn = document.getElementById("emojiBtn");
  const attachBtn = document.getElementById("attachBtn");

  // Use persistent chat state instead of creating new one
  window.chatState = window.persistentChatState;

  // Event listeners on modal elements
  if (closeBtn) closeBtn.addEventListener("click", closeProfessionalChat);
  if (messageInput) {
    messageInput.addEventListener("input", handleMessageInput);
    messageInput.addEventListener("keydown", handleKeyDown);
    messageInput.focus();
  }
  if (sendBtn) sendBtn.addEventListener("click", sendProfessionalMessage);
  if (emojiBtn) emojiBtn.addEventListener("click", showEmojiPicker);
  if (attachBtn) attachBtn.addEventListener("click", handleFileAttachment);

  // Load existing data or initialize
  if (!window.chatState.initialized) {
    loadInitialData();
    startRealTimeSimulation();
    window.chatState.initialized = true;
  } else {
    // Restore existing messages
    restoreExistingMessages();
  }

  // Update online users
  /* online users populated from Firestore presence */
  // loadOnlineUsers();
  // Attach document-level helpers once
  if (!window._chatFeaturesBound) {
    initializeAllProfessionalFeatures();
    window._chatFeaturesBound = true;
  }
}

/* -------------------- Restore / Input / Typing -------------------- */
function restoreExistingMessages() {
  const messagesContainer = document.getElementById("messagesContainer");
  if (!messagesContainer) return;

  messagesContainer.innerHTML = "";

  const sortedMessages = Array.from(window.chatState.messages.values()).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  sortedMessages.forEach((message) => addMessageToUI(message, false));
  scrollToBottom();
}

function handleMessageInput(e) {
  const input = e.target;
  const sendBtn = document.getElementById("sendMessageBtn");

  // Auto-resize
  input.style.height = "auto";
  input.style.height = Math.min(input.scrollHeight, 128) + "px";

  // Update send button
  if (sendBtn) sendBtn.disabled = !input.value.trim();

  // Typing indicator
  handleTypingIndicator();
}

function handleKeyDown(e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendProfessionalMessage();
  }
}

function handleTypingIndicator() {
  showTypingIndicator("You are typing...");

  if (window.typingTimeout) clearTimeout(window.typingTimeout);

  window.typingTimeout = setTimeout(() => {
    hideTypingIndicator();
  }, 2000);
}

/* -------------------- Send / Render Messages -------------------- */
function sendProfessionalMessage() {
  const messageInput = document.getElementById("messageInput");
  const message = messageInput?.value.trim();

  if (!message || !window.currentUser) return;

  try {
    const messageData = {
      id: `msg_${window.chatState.messageIdCounter++}`,
      text: message,
      authorId: window.currentUser.uid,
      authorName:
        window.currentUserData?.fullName ||
        window.currentUserData?.displayName ||
        "Anonymous",
      authorRole:
        new URLSearchParams(window.location.search).get("role") || "student",
      timestamp: new Date(),
      type: "text",
      edited: false,
      reactions: new Map(),
    };

    // Add to persistent state
    window.chatState.messages.set(messageData.id, messageData);

    // Add to UI
    addMessageToUI(messageData, true);

    // Clear input
    messageInput.value = "";
    messageInput.style.height = "auto";
    const sendBtn = document.getElementById("sendMessageBtn");
    if (sendBtn) sendBtn.disabled = true;

    // Scroll to bottom
    scrollToBottom();

    // Show sent animation
    showMessageSentAnimation();

    console.log("Message sent:", messageData);
  } catch (error) {
    console.error("Error sending message:", error);
    showToast("Failed to send message", "error");
  }
}

function addMessageToUI(message, isNew = false) {
  const messagesContainer = document.getElementById("messagesContainer");
  if (!messagesContainer) return;

  // Remove loading indicator if exists
  const loadingIndicator = messagesContainer.querySelector(".justify-center");
  if (loadingIndicator) loadingIndicator.remove();

  const isOwn = message.authorId === window.currentUser?.uid;
  const messageElement = createMessageElement(message, isOwn);

  if (isNew) {
    messageElement.classList.add(
      isOwn ? "animate-slideInFromRight" : "animate-slideInFromLeft"
    );
  }

  messagesContainer.appendChild(messageElement);
  if (isNew) scrollToBottom();
}

function createMessageElement(message, isOwn) {
  const messageDiv = document.createElement("div");
  messageDiv.className = `flex ${
    isOwn ? "justify-end" : "justify-start"
  } group message-container`;
  messageDiv.setAttribute("data-message-id", message.id);

  const timestamp =
    message.timestamp instanceof Date
      ? message.timestamp
      : new Date(message.timestamp);
  const timeStr = formatTime(timestamp);

  messageDiv.innerHTML = `
    <div class="flex ${
      isOwn ? "flex-row-reverse" : "flex-row"
    } items-start gap-3 message-bubble relative">
      <!-- Message Actions -->
      <div class="message-actions ${isOwn ? "right-0" : "left-0"}">
        <button class="message-action-btn" onclick="addMessageReaction('${
          message.id
        }', '👍')" title="Like">👍</button>
        <button class="message-action-btn" onclick="addMessageReaction('${
          message.id
        }', '❤️')" title="Love">❤️</button>
        ${
          isOwn
            ? `<button class="message-action-btn" onclick="editProfessionalMessage('${message.id}')" title="Edit">✏️</button>`
            : ""
        }
      </div>

      <div class="w-10 h-10 rounded-full ${
        isOwn ? "bg-blue-500" : "bg-gray-500"
      } flex items-center justify-center text-white text-sm font-medium flex-shrink-0">
        ${
          message.authorName
            ?.split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2) || "?"
        }
      </div>
      
      <div class="flex flex-col ${
        isOwn ? "items-end" : "items-start"
      } space-y-1 max-w-md">
        <div class="flex items-center gap-2 ${
          isOwn ? "flex-row-reverse" : "flex-row"
        }">
          <span class="text-sm font-medium text-gray-700">${escapeHtml(
            message.authorName
          )}</span>
          <span class="text-xs px-2 py-1 rounded-full border ${getRoleColor(
            message.authorRole
          )} font-medium capitalize">${message.authorRole}</span>
        </div>
        
        <div class="relative">
          <div class="${
            isOwn ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-900"
          } px-4 py-2 rounded-2xl ${
    isOwn ? "rounded-br-sm" : "rounded-bl-sm"
  } shadow-sm">
            <p class="whitespace-pre-wrap break-words">${escapeHtml(
              message.text
            )}</p>
            ${
              message.edited
                ? '<p class="text-xs opacity-70 mt-1">(edited)</p>'
                : ""
            }
          </div>
          
          <!-- Reactions -->
          <div class="message-reactions">
            ${Array.from(message.reactions || [])
              .map(
                ([emoji, users]) =>
                  `<span class="reaction-button ${
                    users.includes(window.currentUser?.uid) ? "active" : ""
                  }" onclick="toggleMessageReaction('${
                    message.id
                  }', '${emoji}')">
                  ${emoji} ${users.length}
                 </span>`
              )
              .join("")}
          </div>
        </div>
        
        <span class="text-xs text-gray-500">${timeStr}</span>
      </div>
    </div>
  `;

  return messageDiv;
}

/* -------------------- Emoji Picker / Attach -------------------- */
function showEmojiPicker(e) {
  const existingPicker = document.querySelector(".professional-emoji-picker");
  if (existingPicker) {
    existingPicker.remove();
    return;
  }

  const emojis = [
    "😀",
    "😂",
    "😍",
    "🤔",
    "👍",
    "❤️",
    "🎉",
    "🔥",
    "💯",
    "✨",
    "🚀",
    "💪",
    "👏",
    "🙌",
    "😎",
    "🤝",
    "💡",
    "⭐",
    "🎯",
    "🏆",
  ];

  const picker = document.createElement("div");
  picker.className = "professional-emoji-picker";

  const buttonRect = e.target.getBoundingClientRect();
  picker.style.left = buttonRect.left - 200 + "px";
  picker.style.top = buttonRect.top - 280 + "px";

  picker.innerHTML = emojis
    .map(
      (emoji) =>
        `<button onclick="insertEmoji('${emoji}')" title="${emoji}">${emoji}</button>`
    )
    .join("");

  document.body.appendChild(picker);

  // Close on outside click
  setTimeout(() => {
    const closeEmojiPicker = (event) => {
      if (!picker.contains(event.target) && event.target !== e.target) {
        picker.remove();
        document.removeEventListener("click", closeEmojiPicker);
      }
    };
    document.addEventListener("click", closeEmojiPicker);
  }, 100);
}

window.insertEmoji = function (emoji) {
  const messageInput = document.getElementById("messageInput");
  if (messageInput) {
    const start = messageInput.selectionStart;
    const end = messageInput.selectionEnd;
    const text = messageInput.value;
    messageInput.value = text.substring(0, start) + emoji + text.substring(end);
    messageInput.setSelectionRange(start + emoji.length, start + emoji.length);
    messageInput.focus();
    messageInput.dispatchEvent(new Event("input"));
  }
  document.querySelector(".professional-emoji-picker")?.remove();
};

function handleFileAttachment() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,video/*,.pdf,.doc,.docx,.txt";
  input.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      showToast(
        `File "${file.name}" selected. Upload feature ready for integration!`,
        "info"
      );
    }
  };
  input.click();
}

/* -------------------- Reactions / Edit / Update -------------------- */
window.addMessageReaction = function (messageId, emoji) {
  const message = window.chatState.messages.get(messageId);
  if (!message) return;

  if (!message.reactions) message.reactions = new Map();
  if (!message.reactions.has(emoji)) message.reactions.set(emoji, []);

  const users = message.reactions.get(emoji);
  const userId = window.currentUser?.uid;
  if (!userId) return;

  const userIndex = users.indexOf(userId);
  if (userIndex === -1) {
    users.push(userId);
  } else {
    users.splice(userIndex, 1);
    if (users.length === 0) message.reactions.delete(emoji);
  }

  updateMessageInUI(message);
};

window.toggleMessageReaction = function (messageId, emoji) {
  addMessageReaction(messageId, emoji);
};

window.editProfessionalMessage = function (messageId) {
  const message = window.chatState.messages.get(messageId);
  if (!message || message.authorId !== window.currentUser?.uid) return;

  const newText = prompt("Edit your message:", message.text);
  if (newText && newText.trim() !== message.text) {
    message.text = newText.trim();
    message.edited = true;
    message.editedAt = new Date();
    updateMessageInUI(message);
  }
};

function updateMessageInUI(message) {
  const messageElement = document.querySelector(
    `[data-message-id="${message.id}"]`
  );
  if (messageElement) {
    const isOwn = message.authorId === window.currentUser?.uid;
    const newElement = createMessageElement(message, isOwn);
    messageElement.replaceWith(newElement);
  }
}

/* -------------------- Seed / Simulation -------------------- */
function loadInitialData() {
  if (window.chatState.messages.size === 0) {
    setTimeout(() => {
      const welcomeMessage = {
        id: `msg_${window.chatState.messageIdCounter++}`,
        text: "Welcome to the Professional Group Chat! 🎉\n\nThis is a fully functional real-time messaging system with modern design and professional features.",
        authorId: "system",
        authorName: "System",
        authorRole: "admin",
        timestamp: new Date(),
        type: "text",
        edited: false,
        reactions: new Map(),
      };

      window.chatState.messages.set(welcomeMessage.id, welcomeMessage);
      addMessageToUI(welcomeMessage);
    }, 1000);
  }
}

function startRealTimeSimulation() {
  if (!window.chatSimulationStarted) {
    window.chatSimulationStarted = true;
    setInterval(() => {
      if (Math.random() > 0.95 && document.getElementById("chatModal")) {
        simulateIncomingMessage();
      }
    }, 10000);
  }
}

function simulateIncomingMessage() {
  const sampleMessages = [
    "Great discussion everyone! 👏",
    "Thanks for sharing that resource.",
    "I have a question about the assignment.",
    "Looking forward to the next session!",
    "Does anyone have the notes from yesterday?",
  ];

  const sampleUsers = [
    { id: "user2", name: "Dr. Smith", role: "faculty" },
    { id: "user3", name: "Admin User", role: "admin" },
    { id: "user5", name: "Student A", role: "student" },
  ];

  if (window.chatState.messages.size < 15) {
    const randomMessage =
      sampleMessages[Math.floor(Math.random() * sampleMessages.length)];
    const randomUser =
      sampleUsers[Math.floor(Math.random() * sampleUsers.length)];

    const messageData = {
      id: `msg_${window.chatState.messageIdCounter++}`,
      text: randomMessage,
      authorId: randomUser.id,
      authorName: randomUser.name,
      authorRole: randomUser.role,
      timestamp: new Date(),
      type: "text",
      edited: false,
      reactions: new Map(),
    };

    window.chatState.messages.set(messageData.id, messageData);
    addMessageToUI(messageData, true);
    showToast(`New message from ${randomUser.name}`, "info");
  }
}

/* -------------------- Online Users -------------------- */
function updateOnlineUsers(users) {
  const onlineCount = document.getElementById("onlineCount");
  const onlineUsersList = document.getElementById("onlineUsersList");

  const onlineUsersArray = users.filter((user) => user.isOnline);

  if (onlineCount)
    onlineCount.textContent = `${onlineUsersArray.length} members online`;

  if (onlineUsersList) {
    onlineUsersList.innerHTML = users
      .map(
        (user) => `
      <div class="flex items-center gap-3 p-3 rounded-xl hover:bg-white transition-colors ${
        user.id === window.currentUser?.uid
          ? "bg-blue-50 border border-blue-200"
          : ""
      }">
        <div class="w-10 h-10 ${
          user.isOnline ? "bg-green-500" : "bg-gray-400"
        } rounded-full flex items-center justify-center text-white text-sm font-medium">
          ${user.name
            .split(" ")
            .map((n) => n[0])
            .join("")
            .toUpperCase()
            .slice(0, 2)}
        </div>
        <div class="flex-1">
          <div class="text-gray-900 text-sm font-medium">${user.name} ${
          user.id === window.currentUser?.uid ? "(You)" : ""
        }</div>
          <div class="text-gray-500 text-xs capitalize">${user.role}</div>
        </div>
        <div class="w-2 h-2 ${
          user.isOnline ? "bg-green-400" : "bg-gray-300"
        } rounded-full"></div>
      </div>
    `
      )
      .join("");
  }
}

/* -------------------- Typing Indicator -------------------- */
function showTypingIndicator(text) {
  const indicators = document.getElementById("typingIndicators");
  if (indicators) {
    indicators.innerHTML = `
      <div class="flex items-center gap-2 text-gray-500 text-sm">
        <div class="flex gap-1">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
        <span>${text}</span>
      </div>
    `;
  }
}

function hideTypingIndicator() {
  const indicators = document.getElementById("typingIndicators");
  if (indicators) indicators.innerHTML = "";
}

/* -------------------- Close Chat -------------------- */
function closeProfessionalChat() {
  try {
    if (window.typingTimeout) clearTimeout(window.typingTimeout);

    const modal = document.getElementById("chatModal");
    if (modal) {
      modal.style.opacity = "0";
      modal.style.transform = "scale(0.95)";
      setTimeout(() => modal.remove(), 200);
    }

    // Remove styles for this session (listeners remain bound once globally)
    const styles = document.getElementById("professionalChatStyles");
    if (styles) styles.remove();

    console.log("Professional chat closed successfully - messages saved! 🚀");
  } catch (error) {
    console.error("Error closing chat:", error);
  }
}

/* -------------------- Utils -------------------- */
function scrollToBottom() {
  const container = document.getElementById("messagesContainer");
  if (container) {
    setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);
  }
}

function showMessageSentAnimation() {
  const sendBtn = document.getElementById("sendMessageBtn");
  if (sendBtn) {
    sendBtn.style.transform = "scale(0.95)";
    setTimeout(() => {
      sendBtn.style.transform = "scale(1)";
    }, 150);
  }
}

function getRoleColor(role) {
  const colors = {
    admin: "bg-red-100 text-red-700 border-red-200",
    faculty: "bg-blue-100 text-blue-700 border-blue-200",
    student: "bg-green-100 text-green-700 border-green-200",
    system: "bg-purple-100 text-purple-700 border-purple-200",
  };
  return colors[role] || colors.student;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text || "";
  return div.innerHTML;
}

function formatTime(date) {
  const now = new Date();
  const diff = now - date;

  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/* -------------------- Context Menu & Shortcuts (idempotent) -------------------- */
function initializeProfessionalContextMenu() {
  if (window._contextMenuBound) return;
  window._contextMenuBound = true;

  document.addEventListener("contextmenu", (e) => {
    const messageElement = e.target.closest("[data-message-id]");
    if (messageElement && document.getElementById("chatModal")) {
      e.preventDefault();
      showProfessionalContextMenu(e, messageElement);
    }
  });
}

function showProfessionalContextMenu(e, messageElement) {
  document.querySelector(".context-menu")?.remove();

  const messageId = messageElement.getAttribute("data-message-id");
  const message = window.chatState?.messages?.get(messageId);
  if (!message) return;

  const contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.style.left = e.pageX + "px";
  contextMenu.style.top = e.pageY + "px";

  const menuItems = [
    {
      text: "Copy Message",
      action: () => {
        navigator.clipboard.writeText(message.text);
        showToast("Message copied to clipboard", "success");
      },
    },
    {
      text: "React with 👍",
      action: () => addMessageReaction(messageId, "👍"),
    },
    {
      text: "React with ❤️",
      action: () => addMessageReaction(messageId, "❤️"),
    },
  ];

  if (message.authorId === window.currentUser?.uid) {
    menuItems.push(
      {
        text: "Edit Message",
        action: () => editProfessionalMessage(messageId),
      },
      {
        text: "Delete Message",
        action: () => deleteProfessionalMessage(messageId),
      }
    );
  }

  contextMenu.innerHTML = menuItems
    .map(
      (item) =>
        `<button onclick="document.querySelector('.context-menu')?.remove(); (${item.action.toString()})()">${
          item.text
        }</button>`
    )
    .join("");

  document.body.appendChild(contextMenu);

  // Remove on outside click
  setTimeout(() => {
    const closeContextMenu = (event) => {
      if (!contextMenu.contains(event.target)) {
        contextMenu.remove();
        document.removeEventListener("click", closeContextMenu);
      }
    };
    document.addEventListener("click", closeContextMenu);
  }, 100);
}

window.deleteProfessionalMessage = function (messageId) {
  if (confirm("Are you sure you want to delete this message?")) {
    const message = window.chatState?.messages?.get(messageId);
    if (message && message.authorId === window.currentUser?.uid) {
      window.chatState.messages.delete(messageId);
      const messageElement = document.querySelector(
        `[data-message-id="${messageId}"]`
      );
      if (messageElement) {
        messageElement.style.opacity = "0";
        messageElement.style.transform = "scale(0.95)";
        setTimeout(() => messageElement.remove(), 200);
      }
      showToast("Message deleted", "success");
    }
  }
};

function initializeProfessionalKeyboardShortcuts() {
  if (window._keyboardShortcutsBound) return;
  window._keyboardShortcutsBound = true;

  document.addEventListener("keydown", (e) => {
    if (!document.getElementById("chatModal")) return;

    if (e.key === "Escape") closeProfessionalChat();

    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      const messageInput = document.getElementById("messageInput");
      messageInput?.focus();
    }
  });
}

function initializeAllProfessionalFeatures() {
  initializeProfessionalKeyboardShortcuts();
  initializeProfessionalContextMenu();
}

/* -------------------- Exports / Safety -------------------- */
window.showChat = showChat;
window.closeProfessionalChat = closeProfessionalChat;

// Expose toast globally if not already provided
if (typeof window.showToast === "undefined") {
  window.showToast = showToast;
}

console.log("Professional Group Chat System loaded successfully! 🚀");

// -------------------- Timetable Management --------------------
// This function is called to show the timetable management modal
// It includes enhanced UI, color coding, and improved user experience
// ===== ROLE DETECTION SYSTEM =====
// Add this code to your main script (before showTimetable is called)

// Global variables for user role and email
let currentUserRole = null;
let currentUserEmail = null;

// Initialize user data when authentication state changes
auth.onAuthStateChanged(async (user) => {
  if (user) {
    currentUserEmail = user.email;

    try {
      // Get user role from Firestore users collection
      const userDoc = await getDoc(doc(db, "users", user.uid));
      if (userDoc.exists()) {
        const userData = userDoc.data();
        currentUserRole = userData.role || "student";
        window.userRole = currentUserRole; // Set global variable
        console.log(
          "✅ User role loaded:",
          currentUserRole,
          "for email:",
          currentUserEmail
        );

        // Update UI if timetable is already open
        updateTimetablePermissions();
      } else {
        console.warn("❌ User document not found in Firestore");
        currentUserRole = "student";
        window.userRole = "student";
      }
    } catch (error) {
      console.error("❌ Error fetching user role:", error);
      currentUserRole = "student";
      window.userRole = "student";
    }
  } else {
    currentUserRole = null;
    currentUserEmail = null;
    window.userRole = null;
  }
});

// Helper functions that your timetable code expects
function getCurrentUserRole() {
  const role = currentUserRole || window.userRole || "student";
  console.log("🔍 getCurrentUserRole called, returning:", role);
  return role;
}

function getCurrentUserEmail() {
  const email =
    currentUserEmail || (auth.currentUser ? auth.currentUser.email : null);
  console.log("🔍 getCurrentUserEmail called, returning:", email);
  return email;
}

function hasTimetablePermission(permission) {
  const role = getCurrentUserRole();
  console.log("🔍 hasPermission called for:", permission, "with role:", role);

  if (permission === "canCreateTimetable") {
    return role === "admin" || role === "faculty";
  }
  return false;
}

function getUserRole() {
  return getCurrentUserRole();
}

// Function to update timetable UI when role changes
function updateTimetablePermissions() {
  const timetableModal = document.getElementById("timetableModal");
  if (timetableModal) {
    console.log("🔄 Updating timetable permissions...");
    // Refresh timetable to show/hide buttons based on new role
    setTimeout(() => {
      const addClassBtn = document.getElementById("openAddClassModal");
      const addCourseBtn = document.getElementById("addCourseBtn");

      if (addClassBtn || addCourseBtn) {
        console.log(
          "📝 Timetable is open, but permissions might have changed. Consider reopening timetable."
        );
      }
    }, 100);
  }
}

// Make functions globally available
window.getCurrentUserRole = getCurrentUserRole;
window.getCurrentUserEmail = getCurrentUserEmail;
window.hasPermission = hasPermission;
window.getUserRole = getUserRole;

// ===== IMPROVED canModifyTimetable FUNCTION =====
function canModifyTimetable() {
  return window.userRole === "faculty" || window.userRole === "admin";
}

// ===== DEBUGGING FUNCTION =====
function debugRoleDetection() {
  console.log("=== ROLE DETECTION DEBUG ===");
  console.log("currentUserRole:", currentUserRole);
  console.log("window.userRole:", window.userRole);
  console.log("getCurrentUserRole():", getCurrentUserRole());
  console.log("auth.currentUser:", auth.currentUser);
  console.log("canModifyTimetable():", canModifyTimetable());
  console.log(
    'hasPermission("canCreateTimetable"):',
    hasPermission("canCreateTimetable")
  );

  if (auth.currentUser) {
    getDoc(doc(db, "users", auth.currentUser.uid)).then((userDoc) => {
      if (userDoc.exists()) {
        console.log("Firestore user data:", userDoc.data());
      } else {
        console.log(
          "❌ No user document found in Firestore for UID:",
          auth.currentUser.uid
        );
      }
    });
  }
}

// Make debug function available globally
window.debugRoleDetection = debugRoleDetection;

// -------------------- Timetable Management Function ---------------------
// This function is called to show the timetable management modal
// It includes enhanced UI, color coding, and improved user experience
// Call this function to display the timetable modal
// Ensure this is called after user authentication state is set
// --- Add course modal ---
// --- Global constants ---
const days = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const timeSlots = [
  "9:00 AM",
  "10:00 AM",
  "11:00 AM",
  "BREAK",
  "12:00 PM",
  "1:00 PM",
  "BREAK",
  "2:00 PM",
  "3:00 PM",
  "BREAK",
  "4:00 PM",
];

const subjectColors = {
  Mathematics: "#e0f2fe",
  Chemistry: "#fef2f2",
  Physics: "#f0fdf4",
  Biology: "#fefce8",
  "Computer Science": "#ecfdf5",
  English: "#faf5ff",
  "Data Structures": "#fef7ff",
  Algorithms: "#f0fdfa",
};

function getColor(subject) {
  return (
    subjectColors[subject] ||
    [
      "#fef7ff",
      "#f0fdfa",
      "#ecfdf5",
      "#f7fee7",
      "#fefce8",
      "#fff7ed",
      "#fef2f2",
      "#f8fafc",
      "#f0f9ff",
      "#eef2ff",
    ][Math.floor(Math.random() * 10)]
  );
}

// --- Global state ---
let selectedCourse = "CSE";
let selectedSection = "A";
let availableCourses = []; // also needed globally

// --- Add Course Modal ---
function showAddCourseModal() {
  document.getElementById("addCourseModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "addCourseModal";
  modal.className =
    "fixed inset-0 z-[1100] flex items-center justify-center p-4";
  modal.innerHTML = `
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 mx-4">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-xl font-bold text-indigo-700">Add New Course</h3>
          <button id="courseCloseBtn" class="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center hover:bg-gray-200">✕</button>
        </div>
        <form id="addCourseForm" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Course Name</label>
            <input type="text" id="courseNameInput" class="w-full p-3 border border-gray-200 rounded-xl" placeholder="e.g., Computer Science & Engineering">
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Course Code</label>
            <input type="text" id="courseCodeInput" class="w-full p-3 border border-gray-200 rounded-xl" placeholder="e.g., CSE">
          </div>
          <div class="flex gap-3 pt-4">
            <button type="button" id="courseCancelBtn" class="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl hover:bg-gray-200">Cancel</button>
            <button type="submit" class="flex-1 bg-indigo-600 text-white py-3 rounded-xl hover:bg-indigo-700">Add Course</button>
          </div>
        </form>
      </div>
    `;
  document.body.appendChild(modal);
  modal.style.zIndex = "200000"; // Force on top of other modals

  modal.querySelector("#courseCloseBtn").onclick = () => modal.remove();
  modal.querySelector(".absolute").onclick = () => modal.remove();
  modal.querySelector("#courseCancelBtn").onclick = () => modal.remove();

  modal.querySelector("#addCourseForm").onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById("courseNameInput").value.trim();
    const code = document
      .getElementById("courseCodeInput")
      .value.trim()
      .toUpperCase();
    if (!name || !code) return alert("Please fill all fields");
    if (availableCourses.includes(code))
      return alert("Course code already exists");
    try {
      await addDoc(collection(db, "courses"), {
        name: code,
        fullName: name,
        active: true,
        createdAt: serverTimestamp(),
        createdBy: window.currentUser?.email || "system",
      });
      showToast("Course added successfully!", "success");
      modal.remove();
    } catch (error) {
      showToast("Failed to add course", "error");
    }
  };
}

// --- Add Class Modal ---
function showAddClassModal(preDay = "", preTime = "") {
  document.getElementById("addClassModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "addClassModal";
  modal.className =
    "fixed inset-0 z-[1100] flex items-center justify-center p-4";
  modal.innerHTML = `
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm"></div>
      <div class="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 mx-4">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-xl font-bold text-indigo-700">Add New Class</h3>
          <button id="addCloseBtn" class="w-9 h-9 bg-gray-100 rounded-xl flex items-center justify-center hover:bg-gray-200">✕</button>
        </div>
        <form id="addClassForm" class="space-y-4" novalidate>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Subject *</label>
            <input type="text" id="subjectInput" class="w-full p-3 border border-gray-200 rounded-xl" placeholder="Enter subject name">
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Teacher *</label>
            <input type="text" id="teacherInput" class="w-full p-3 border border-gray-200 rounded-xl" placeholder="Enter teacher name">
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Room *</label>
            <input type="text" id="roomInput" class="w-full p-3 border border-gray-200 rounded-xl" placeholder="Enter room number">
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Day *</label>
              <select id="daySelect" class="w-full p-3 border border-gray-200 rounded-xl">
                <option value="">Select Day</option>
                ${days
                  .map(
                    (d) =>
                      `<option value="${d}" ${
                        preDay === d ? "selected" : ""
                      }>${d}</option>`
                  )
                  .join("")}
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Time *</label>
              <select id="timeSelect" class="w-full p-3 border border-gray-200 rounded-xl">
                <option value="">Select Time</option>
                ${timeSlots
                  .filter((t) => t !== "BREAK")
                  .map(
                    (t) =>
                      `<option value="${t}" ${
                        preTime === t ? "selected" : ""
                      }>${t}</option>`
                  )
                  .join("")}
              </select>
            </div>
          </div>
          <div class="flex gap-3 pt-6">
            <button type="button" id="cancelBtn" class="flex-1 bg-gray-100 text-gray-700 py-3 rounded-xl hover:bg-gray-200">Cancel</button>
            <button type="submit" class="flex-1 bg-indigo-600 text-white py-3 rounded-xl hover:bg-indigo-700">Add Class</button>
          </div>
        </form>
      </div>
    `;
  document.body.appendChild(modal);
  modal.style.zIndex = "200000"; // Force on top of other modals

  // Setup close handlers
  modal.querySelector("#addCloseBtn").onclick = () => modal.remove();
  modal.querySelector(".absolute").onclick = () => modal.remove();
  modal.querySelector("#cancelBtn").onclick = () => modal.remove();

  // ✅ FIX: Attach form submit handler directly (no cloning needed)
  const form = modal.querySelector("#addClassForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    console.log("🔄 Form submit triggered"); // Debug log

    // Get form values using modal scope to avoid conflicts
    const subject = modal.querySelector("#subjectInput").value.trim();
    const teacher = modal.querySelector("#teacherInput").value.trim();
    const room = modal.querySelector("#roomInput").value.trim();
    const day = modal.querySelector("#daySelect").value.trim();
    const time = modal.querySelector("#timeSelect").value.trim();

    console.log("📝 Form data:", { subject, teacher, room, day, time }); // Debug log

    // Validation
    if (!subject || !teacher || !room || !day || !time) {
      console.log("❌ Validation failed: Missing fields");
      showToast("All fields are required", "error");
      return;
    }

    // Check Firebase connection
    if (typeof db === "undefined") {
      console.error("❌ Firebase db not initialized");
      showToast("Database connection error", "error");
      return;
    }

    const classId = `${day}_${time}`.replace(/[^\w-]/g, "_");
    const payload = {
      course: selectedCourse,
      section: selectedSection,
      day,
      time,
      subject,
      teacher,
      room,
      color: getColor(subject),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      createdBy: window.currentUser?.email || "system",
    };

    try {
      console.log("🚀 Attempting to save class...");

      const classDocRef = doc(
        db,
        "timetable",
        selectedCourse,
        "sections",
        selectedSection,
        "classes",
        classId
      );

      console.log("📌 Firestore path:", classDocRef.path);
      console.log("📦 Payload:", payload);

      // Check if class already exists
      const existing = await getDoc(classDocRef);
      if (existing.exists()) {
        console.log("⚠️ Class already exists");
        showToast("Class already exists for this time slot", "error");
        return;
      }

      // Save to Firestore
      await setDoc(classDocRef, payload);
      console.log("✅ Class saved successfully");
      showToast("Class added successfully!", "success");
      modal.remove();

      // Refresh timetable if function exists
      if (typeof attachRealtime === "function") {
        attachRealtime();
      }
    } catch (err) {
      console.error("❌ Firestore Save Error:", err);
      console.error("Error details:", err.message, err.code);
      showToast(`Error adding class: ${err.message}`, "error");
    }
  });
}

// Main function to show the timetable modal
function showTimetable() {
  // Remove previous modals
  document.getElementById("timetableModal")?.remove();
  document.getElementById("addClassModal")?.remove();
  document.getElementById("addCourseModal")?.remove();

  // --- CONFIG ---
  const baseCourses = ["CSE", "ECE", "ME", "EEE"];
  const sections = ["A", "B", "C"];

  function canModifyTimetable() {
    const role = (
      window.currentUserData?.role ||
      window.userRole ||
      "student"
    ).toLowerCase();
    return role === "admin" || role === "faculty";
  }

  selectedCourse = baseCourses[0];
  selectedSection = sections[0];
  let unsubscribe = null;
  let courseUnsubscribe = null;
  const slotMap = new Map();
  availableCourses = [...baseCourses];

  // --- MODAL HTML ---
  const modalContainer =
    document.getElementById("dynamicModalContainer") || document.body;
  const wrap = document.createElement("div");
  wrap.id = "timetableModal";
  wrap.className =
    "fixed inset-0 z-[1000] flex items-center justify-center p-4";
  wrap.innerHTML = `
    <div class="absolute inset-0 bg-gradient-to-br from-slate-900/90 via-purple-900/90 to-slate-900/90 backdrop-bl-md" id="ttOverlay"></div>
    <div class="relative bg-white rounded-3xl w-full max-w-7xl mx-4 shadow-2xl ring-1 ring-white/20 max-h-[95vh] overflow-hidden border border-white/10">
      <div class="px-8 py-6 flex items-center justify-between bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 rounded-t-3xl">
        <div class="flex items-center gap-4">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
            <span class="text-2xl">📅</span>
          </div>
          <div>
            <h2 class="text-3xl font-bold text-white">Timetable Management</h2>
            <p class="text-white/80 text-sm">Plan, add, and view classes</p>
          </div>
        </div>
        <div class="flex items-center gap-3">
          ${
            canModifyTimetable()
              ? `
            <button id="addCourseBtn" class="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-sm font-medium shadow-sm flex items-center gap-2 transition"><span class="text-lg">🎓</span> Add Course</button>
            <button id="openAddClassModal" class="px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 text-white text-sm font-medium shadow-sm flex items-center gap-2 transition"><span class="text-lg">➕</span> Add Class</button>
          `
              : ""
          }
          <button id="closeTimetableModalBtn" class="w-11 h-11 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center text-white text-xl transition-all duration-200 backdrop-blur-sm">✕</button>
        </div>
      </div>
      <div class="bg-white rounded-b-3xl p-6 border-b border-indigo-100">
        <div class="flex flex-wrap items-center gap-6">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">🎓 Course</label>
            <select id="courseSelect" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-medium bg-gray-50"></select>
          </div>
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-1">📚 Section</label>
            <select id="sectionSelect" class="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 font-medium bg-gray-50"></select>
          </div>
          <div>
            <span class="inline-flex items-center px-4 py-2 rounded-lg bg-green-50 text-green-700 text-sm font-medium"><span class="w-2 h-2 bg-green-500 rounded-full mr-2"></span>Real-time sync active</span>
          </div>
        </div>
      </div>
      <div class="p-8 overflow-y-auto max-h-[calc(95vh-180px)]">
        <div class="bg-white rounded-2xl shadow-lg border border-gray-100 overflow-hidden" id="timetableScrollArea">
          <div class="overflow-x-auto">
            <table id="ttGrid" class="min-w-full border-separate border-spacing-0"></table>
          </div>
        </div>
      </div>
    </div>
  `;
  modalContainer.appendChild(wrap);

  // --- Dropdowns ---
  const courseSelect = wrap.querySelector("#courseSelect");
  const sectionSelect = wrap.querySelector("#sectionSelect");
  function updateCourseDropdown() {
    courseSelect.innerHTML = availableCourses
      .map((courseName) => {
        // If it's already a full name, use it directly
        // If it's a code, convert to full name
        const displayName =
          courseName.length <= 4 ? getCourseFullName(courseName) : courseName;
        return `<option value="${courseName}">${displayName}</option>`;
      })
      .join("");
    courseSelect.value = selectedCourse;
  }

  // Helper function to get full course names
  function getCourseFullName(code) {
    const courseNames = {
      CSE: "Computer Science Engineering",
      ECE: "Electronics and Communication Engineering",
      ME: "Mechanical Engineering",
      EEE: "Electrical and Electronics Engineering",
      AIML: "Artificial Intelligence and Machine Learning",
      IT: "Information Technology",
      CE: "Civil Engineering",
      AE: "Aeronautical Engineering",
      BME: "Biomedical Engineering",
      CHE: "Chemical Engineering",
    };
    return courseNames[code] || code; // Return full name or code as fallback
  }
  sectionSelect.innerHTML = sections
    .map((s) => `<option value="${s}">${s}</option>`)
    .join("");
  sectionSelect.value = selectedSection;
  function setupCourseListener() {
    try {
      courseUnsubscribe = onSnapshot(
        collection(db, "courses"),
        (snapshot) => {
          const dbCourses = [];
          snapshot.forEach((doc) => {
            const data = doc.data();
            console.log("📚 Database course:", data); // Debug log to see what's in DB
            if (data.name && data.active !== false) {
              dbCourses.push(data.name);
            }
          });

          console.log("📋 Base courses:", baseCourses); // Debug log
          console.log("📋 DB courses:", dbCourses); // Debug log

          // ✅ FIX: Use ONLY database courses if they exist, otherwise use base courses
          if (dbCourses.length > 0) {
            availableCourses = [...new Set(dbCourses)].sort(); // Use only DB courses
          } else {
            availableCourses = [...baseCourses]; // Fallback to base courses
          }

          console.log("📋 Final courses:", availableCourses); // Debug log
          updateCourseDropdown();
        },
        (error) => {
          console.warn("Course listener error:", error);
          availableCourses = [...baseCourses];
          updateCourseDropdown();
        }
      );
    } catch (error) {
      console.warn("Course setup error:", error);
      availableCourses = [...baseCourses];
      updateCourseDropdown();
    }
  }
  setupCourseListener();
  updateCourseDropdown();

  // --- Event listeners for modal controls ---
  wrap.querySelector("#closeTimetableModalBtn").onclick = () => {
    unsubscribe?.();
    courseUnsubscribe?.();
    wrap.remove();
    document.getElementById("addClassModal")?.remove();
    document.getElementById("addCourseModal")?.remove();
  };
  wrap.querySelector("#ttOverlay").onclick = () => {
    wrap.querySelector("#closeTimetableModalBtn").click();
  };

  courseSelect.onchange = (e) => {
    selectedCourse = e.target.value;
    attachRealtime();
  };
  sectionSelect.onchange = (e) => {
    selectedSection = e.target.value;
    attachRealtime();
  };

  // --- Timetable Grid Render ---
  function renderTimetableGrid() {
    const grid = wrap.querySelector("#ttGrid");
    let html = "";

    // Header Row
    html += `<thead><tr>
      <th class="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold p-4 text-center" style="border-top-left-radius: 16px;">⏰ Time</th>
      ${days
        .map(
          (day) =>
            `<th class="bg-gradient-to-r from-indigo-500 to-purple-600 text-white font-bold p-4 text-center">${day}</th>`
        )
        .join("")}
    </tr></thead>`;

    html += `<tbody>`;
    timeSlots.forEach((time, slotIdx) => {
      if (time === "BREAK") {
        html += `
          <tr>
            <td colspan="${
              days.length + 1
            }" class="bg-yellow-50 text-yellow-700 text-center font-bold py-4 border-b border-t border-yellow-200">
              🍵 Break
            </td>
          </tr>
        `;
        return;
      }
      html += `<tr>`;
      html += `<td class="bg-gray-50 text-gray-800 font-semibold p-4 text-center border-r border-gray-200">${time}</td>`;
      days.forEach((day) => {
        const key = `${day}-${time}`;
        const data = slotMap.get(key);
        if (data) {
          const bg = data.color || getColor(data.subject);
          html += `
            <td class="relative group border border-gray-100 p-0">
              <div class="p-4 min-h-[80px] h-full flex flex-col justify-between rounded-xl" style="background:${bg};">
                <div class="font-bold text-gray-800 text-sm mb-1">${
                  data.subject || "No Subject"
                }</div>
                <div class="text-xs text-gray-600 mb-1 flex items-center gap-1">👨‍🏫 ${
                  data.teacher || ""
                }</div>
                <div class="text-xs text-gray-600 flex items-center gap-1">🏢 ${
                  data.room || ""
                }</div>
                ${
                  canModifyTimetable()
                    ? `<div class="absolute top-2 right-2 flex gap-1">
                      <button class="edit-btn w-7 h-7 bg-white/80 hover:bg-blue-100 rounded-lg flex items-center justify-center shadow-sm" data-id="${data.id}" data-day="${day}" data-time="${time}" title="Edit class">✏️</button>
                      <button class="delete-btn w-7 h-7 bg-white/80 hover:bg-red-100 rounded-lg flex items-center justify-center shadow-sm" data-id="${data.id}" data-day="${day}" data-time="${time}" title="Delete class">🗑️</button>
                    </div>`
                    : ""
                }
              </div>
            </td>
          `;
        } else {
          html += `
            <td class="border border-gray-100 p-0">
              ${
                canModifyTimetable()
                  ? `<button class="w-full h-full min-h-[80px] flex flex-col items-center justify-center gap-2 group bg-white hover:bg-indigo-50 rounded-xl transition-all"
                    data-add-day="${day}" data-add-time="${time}" title="Add Class">
                    <div class="w-8 h-8 border-2 border-dashed border-indigo-300 group-hover:border-indigo-500 rounded-lg flex items-center justify-center">
                      <span class="text-xl text-indigo-500">＋</span>
                    </div>
                    <span class="text-xs font-medium text-indigo-500">Add Class</span>
                  </button>`
                  : `<div class="w-full h-full min-h-[80px] flex items-center justify-center"><span class="text-gray-300 text-sm">No class</span></div>`
              }
            </td>
          `;
        }
      });
      html += `</tr>`;
    });
    html += `</tbody>`;
    grid.innerHTML = html;

    // --- Responsive Button Listeners ---
    grid.querySelectorAll("button[data-add-day]").forEach((btn) => {
      btn.onclick = () =>
        showAddClassModal(btn.dataset.addDay, btn.dataset.addTime);
    });
    grid.querySelectorAll(".edit-btn").forEach((btn) => {
      btn.onclick = () =>
        editClass(btn.dataset.id, btn.dataset.day, btn.dataset.time);
    });
    grid.querySelectorAll(".delete-btn").forEach((btn) => {
      btn.onclick = () => deleteClass(btn.dataset.id);
    });
  }

  // --- Real-time sync ---
  function attachRealtime() {
    slotMap.clear();
    renderTimetableGrid();
    unsubscribe?.();
    try {
      const classesPath = collection(
        db,
        "timetable",
        selectedCourse,
        "sections",
        selectedSection,
        "classes"
      );
      unsubscribe = onSnapshot(classesPath, (snap) => {
        slotMap.clear();
        snap.forEach((docSnap) => {
          const d = docSnap.data();
          const key = `${d.day}-${d.time}`;
          slotMap.set(key, { id: docSnap.id, ...d });
        });
        renderTimetableGrid();
      });
    } catch (error) {
      renderTimetableGrid();
    }
  }

  // ✅ FIX: Make attachRealtime globally accessible
  window.attachRealtime = attachRealtime;
  attachRealtime();

  // --- Edit/Delete logic ---
  async function editClass(currentId, currentDay, currentTime) {
    showAddClassModal(currentDay, currentTime);
    setTimeout(async () => {
      const modal = document.getElementById("addClassModal");
      if (!modal) return;
      modal.querySelector("h3").textContent = "Edit Class";
      modal.querySelector('button[type="submit"]').textContent = "Update Class";
      const classDocRef = doc(
        db,
        "timetable",
        selectedCourse,
        "sections",
        selectedSection,
        "classes",
        currentId
      );
      try {
        const snap = await getDoc(classDocRef);
        if (snap.exists()) {
          const data = snap.data();
          modal.querySelector("#subjectInput").value = data.subject || "";
          modal.querySelector("#teacherInput").value = data.teacher || "";
          modal.querySelector("#roomInput").value = data.room || "";
          modal.querySelector("#daySelect").value = data.day || "";
          modal.querySelector("#timeSelect").value = data.time || "";

          // ✅ FIX: Remove old listener and add new one for update
          const form = modal.querySelector("#addClassForm");
          const newForm = form.cloneNode(true);
          form.parentNode.replaceChild(newForm, form);

          newForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const subject = modal.querySelector("#subjectInput").value.trim();
            const teacher = modal.querySelector("#teacherInput").value.trim();
            const room = modal.querySelector("#roomInput").value.trim();
            const day = modal.querySelector("#daySelect").value.trim();
            const time = modal.querySelector("#timeSelect").value.trim();

            if (!subject || !teacher || !room || !day || !time) {
              showToast("All fields required", "error");
              return;
            }

            try {
              await updateDoc(classDocRef, {
                subject,
                teacher,
                room,
                day,
                time,
                color: getColor(subject),
                updatedAt: serverTimestamp(),
              });
              showToast("Class updated!", "success");
              modal.remove();
            } catch (err) {
              console.error("❌ Firestore Update Error:", err);
              showToast("Error updating class", "error");
            }
          });
        }
      } catch (error) {
        console.error("Error fetching class data:", error);
        showToast("Error loading class data", "error");
      }
    }, 100);
  }

  async function deleteClass(id) {
    if (!confirm("Delete this class?")) return;
    try {
      const classDocRef = doc(
        db,
        "timetable",
        selectedCourse,
        "sections",
        selectedSection,
        "classes",
        id
      );
      await deleteDoc(classDocRef);
      showToast("Class deleted!", "success");
    } catch (err) {
      showToast("Error deleting class", "error");
    }
  }

  // --- ✅ FIX: Attach listeners to buttons with proper error handling ---
  if (canModifyTimetable()) {
    const addCourseBtn = wrap.querySelector("#addCourseBtn");
    if (addCourseBtn) {
      addCourseBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("🎓 Add Course button clicked");
        showAddCourseModal();
      });
    }

    const addClassBtn = wrap.querySelector("#openAddClassModal");
    if (addClassBtn) {
      addClassBtn.addEventListener("click", (e) => {
        e.preventDefault();
        console.log("➕ Add Class button clicked");
        showAddClassModal();
      });
    }
  }
}

// Make functions globally available
window.showTimetable = showTimetable;
window.showAddCourseModal = showAddCourseModal;
window.showAddClassModal = showAddClassModal;

// -------------------- Polls Management --------------------
// This function is called to show the live polls modal
// It includes real-time updates, voting functionality, and role-based access

// Firestore references assumed: db, currentUserData, currentUser
function showPolls() {
  // Detect role from URL, fallback to "student"
  const urlParams = new URLSearchParams(window.location.search);
  const userRole = urlParams.get("role")
    ? urlParams.get("role").toLowerCase()
    : "student";
  const isFacultyOrAdmin = ["faculty", "admin"].includes(userRole);

  // Modal container
  const modalContainer =
    document.getElementById("dynamicModalContainer") || document.body;
  modalContainer.innerHTML = `
    <div id="pollsModal" class="modal show fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm"></div>
      <div class="bg-white rounded-2xl w-full max-w-4xl mx-4 z-10 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div class="flex items-center justify-between p-6 border-b border-gray-200 bg-indigo-50">
          <h2 class="text-xl font-bold gradient-text">📊 Live Polls</h2>
          <div class="flex items-center gap-3">
            ${
              isFacultyOrAdmin
                ? `<button id="createPollBtn" class="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors text-sm">＋ Create Poll</button>`
                : ""
            }
            <button onclick="closeModal('pollsModal')" class="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center hover:bg-gray-200 transition-colors">✕</button>
          </div>
        </div>
        <div class="p-6 bg-indigo-50 min-h-[300px]">
          <div id="pollsList" class="space-y-6"></div>
        </div>
      </div>
    </div>
  `;

  // Create Poll Button Handler (Faculty/Admin)
  if (isFacultyOrAdmin) {
    setTimeout(() => {
      document.getElementById("createPollBtn").onclick = showCreatePollModal;
    }, 100);
  }

  // Firestore Realtime Polls Listener
  const pollsListEl = modalContainer.querySelector("#pollsList");
  if (!pollsListEl) return;

  const pollsRef = collection(db, "polls");
  const pollsQuery = query(pollsRef, orderBy("createdAt", "desc"));
  onSnapshot(pollsQuery, (snapshot) => {
    const polls = [];
    snapshot.forEach((doc) => polls.push({ id: doc.id, ...doc.data() }));
    if (polls.length === 0) {
      pollsListEl.innerHTML = `<div class="text-center py-12"><div class="text-6xl mb-4">📊</div><p class="text-gray-500">No polls yet</p></div>`;
      return;
    }
    pollsListEl.innerHTML = polls.map(renderPollCard).join("");
  });

  // Render Poll Card
  function renderPollCard(poll) {
    const totalVotes =
      poll.options?.reduce((sum, opt) => sum + (opt.votes || 0), 0) || 0;
    const pollLive = poll.expiresAt
      ? new Date() < poll.expiresAt.toDate?.()
      : true;
    const hasVoted =
      Array.isArray(poll.voters) && poll.voters.includes(currentUser?.uid);

    return `
      <div class="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
        <div class="flex items-start justify-between mb-4">
          <div class="flex-1">
            <h3 class="font-semibold text-gray-800 mb-2">${poll.question}</h3>
            <div class="flex items-center gap-4 text-sm text-gray-500">
              <span>by ${poll.authorName || "Unknown"}</span>
              <span>⏰ ${
                poll.expiresAt ? getTimeLeft(poll.expiresAt) : "No expiry"
              }</span>
              <span>👥 ${totalVotes} votes</span>
            </div>
          </div>
          <div class="flex items-center gap-2 px-3 py-1 bg-green-50 rounded-full">
            <div class="w-2 h-2 bg-green-500 rounded-full pulse-dot"></div>
            <span class="text-xs text-green-700 font-medium">${
              pollLive ? "Live" : "Closed"
            }</span>
          </div>
        </div>
        <div class="space-y-3">
          ${poll.options
            .map((option, idx) => {
              const optVotes = option.votes || 0;
              const pct =
                totalVotes > 0 ? Math.round((optVotes / totalVotes) * 100) : 0;
              return `
                <div class="cursor-pointer group" ${
                  userRole === "student" && pollLive && !hasVoted
                    ? `onclick="votePoll('${poll.id}', ${idx})"`
                    : ""
                }>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700">${
                      option.text
                    }</span>
                    <span class="text-sm text-gray-500">${optVotes} votes (${pct}%)</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div class="h-full ${
                      pct === 100 ? "bg-indigo-600" : "bg-indigo-400"
                    } rounded-full transition-all duration-500 group-hover:bg-indigo-600" style="width: ${pct}%"></div>
                  </div>
                </div>
              `;
            })
            .join("")}
        </div>
        ${isFacultyOrAdmin ? renderPollActions(poll) : ""}
      </div>
    `;
  }

  // Faculty/Admin Poll Actions
  function renderPollActions(poll) {
    return `
      <div class="flex gap-2 mt-4">
        <button onclick="showEditPollModal('${poll.id}')" class="bg-blue-100 text-blue-700 px-3 py-2 rounded text-xs hover:bg-blue-200">Edit</button>
        <button onclick="deletePoll('${poll.id}')" class="bg-red-100 text-red-700 px-3 py-2 rounded text-xs hover:bg-red-200">Delete</button>
        <button onclick="exportPollResponses('${poll.id}', 'csv')" class="bg-gray-100 text-gray-700 px-3 py-2 rounded text-xs hover:bg-gray-200">Export CSV</button>
        <button onclick="exportPollResponses('${poll.id}', 'json')" class="bg-gray-100 text-gray-700 px-3 py-2 rounded text-xs hover:bg-gray-200">Export JSON</button>
        <button onclick="exportPollResponses('${poll.id}', 'excel')" class="bg-gray-100 text-gray-700 px-3 py-2 rounded text-xs hover:bg-gray-200">Export Excel</button>
      </div>
    `;
  }

  // Helper: time left
  function getTimeLeft(expiresAt) {
    const end = expiresAt.toDate ? expiresAt.toDate() : new Date(expiresAt);
    const now = new Date();
    const mins = Math.max(0, Math.floor((end - now) / 1000 / 60));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (mins <= 0) return "Expired";
    if (h) return `${h}h ${m}m left`;
    return `${m}m left`;
  }
}

// Faculty/Admin: Create Poll Modal
function showCreatePollModal() {
  document.getElementById("createPollModal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="createPollModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center" style="z-index:99999;">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4" style="z-index:100000;">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-indigo-700 flex items-center gap-2">
            <span>📊</span> Create Poll
          </h2>
          <button onclick="document.getElementById('createPollModal').remove()" class="w-8 h-8 bg-gray-100 rounded-full hover:bg-gray-200 flex items-center justify-center">✕</button>
        </div>
        <form id="createPollForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">Poll Question *</label>
            <input type="text" id="pollQuestionInput" class="w-full p-3 border border-gray-300 rounded-lg" required placeholder="E.g. What topic should we cover next?">
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Options (one per line, min 2)</label>
            <textarea id="pollOptionsInput" rows="4" class="w-full p-3 border border-gray-300 rounded-lg" required placeholder="Option 1\nOption 2"></textarea>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Expires In (minutes) [optional]</label>
            <input type="number" id="pollExpiresInput" min="1" class="w-full p-3 border border-gray-300 rounded-lg" placeholder="60">
          </div>
          <div class="flex gap-3 mt-4">
            <button type="button" onclick="document.getElementById('createPollModal').remove()" class="flex-1 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400">Cancel</button>
            <button type="submit" class="flex-1 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700">＋ Create Poll</button>
          </div>
        </form>
      </div>
    </div>
    `
  );
  document.getElementById("createPollForm").onsubmit = async function (e) {
    e.preventDefault();
    const question = document.getElementById("pollQuestionInput").value.trim();
    const options = document
      .getElementById("pollOptionsInput")
      .value.split("\n")
      .map((t) => t.trim())
      .filter(Boolean);
    if (options.length < 2) {
      showToast("At least 2 options are required.", "error");
      return;
    }
    const expiresMin = parseInt(
      document.getElementById("pollExpiresInput").value,
      10
    );
    const pollDoc = {
      question,
      options: options.map((text) => ({ text, votes: 0 })),
      authorId: currentUser.uid,
      authorName:
        currentUserData?.fullName || currentUserData?.displayName || "Unknown",
      createdAt: serverTimestamp(),
      voters: [],
      expiresAt:
        expiresMin && !isNaN(expiresMin)
          ? Timestamp.fromDate(new Date(Date.now() + expiresMin * 60 * 1000))
          : null,
    };
    await addDoc(collection(db, "polls"), pollDoc);
    document.getElementById("createPollModal").remove();
    showToast("Poll created!", "success");
  };
}

// Faculty/Admin: Edit Poll Modal
window.showEditPollModal = async function (pollId) {
  // Get poll data
  const pollDocRef = doc(db, "polls", pollId);
  const pollSnap = await getDoc(pollDocRef);
  if (!pollSnap.exists()) return showToast("Poll not found", "error");
  const poll = pollSnap.data();

  // Build options textarea
  const optionLines = poll.options.map((opt) => opt.text).join("\n");

  // Expiry minutes calculation
  let expiresMin = "";
  if (poll.expiresAt && poll.expiresAt.toDate) {
    const now = new Date();
    const end = poll.expiresAt.toDate();
    const diffMin = Math.max(1, Math.round((end - now) / (60 * 1000)));
    expiresMin = diffMin;
  }

  document.getElementById("editPollModal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="editPollModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center" style="z-index:100000;">
      <div class="bg-white rounded-lg shadow-xl w-full max-w-md p-6 mx-4" style="z-index:100001;">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-indigo-700 flex items-center gap-2">
            <span>📊</span> Edit Poll
          </h2>
          <button onclick="document.getElementById('editPollModal').remove()" class="w-8 h-8 bg-gray-100 rounded-full hover:bg-gray-200 flex items-center justify-center">✕</button>
        </div>
        <form id="editPollForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium mb-2">Poll Question *</label>
            <input type="text" id="editPollQuestionInput" class="w-full p-3 border border-gray-300 rounded-lg" required value="${poll.question}">
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Options (one per line, min 2)</label>
            <textarea id="editPollOptionsInput" rows="4" class="w-full p-3 border border-gray-300 rounded-lg" required>${optionLines}</textarea>
          </div>
          <div>
            <label class="block text-sm font-medium mb-2">Expires In (minutes) [optional]</label>
            <input type="number" id="editPollExpiresInput" min="1" class="w-full p-3 border border-gray-300 rounded-lg" value="${expiresMin}">
          </div>
          <div class="flex gap-3 mt-4">
            <button type="button" onclick="document.getElementById('editPollModal').remove()" class="flex-1 bg-gray-300 text-gray-700 py-3 rounded-lg hover:bg-gray-400">Cancel</button>
            <button type="submit" class="flex-1 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
    `
  );

  document.getElementById("editPollForm").onsubmit = async function (e) {
    e.preventDefault();
    const question = document
      .getElementById("editPollQuestionInput")
      .value.trim();
    const options = document
      .getElementById("editPollOptionsInput")
      .value.split("\n")
      .map((t, i) => ({
        text: t.trim(),
        votes:
          poll.options[i] && !isNaN(poll.options[i].votes)
            ? poll.options[i].votes
            : 0,
      }))
      .filter((opt) => opt.text.length > 0);
    if (options.length < 2) {
      showToast("At least 2 options are required.", "error");
      return;
    }
    const expiresMin = parseInt(
      document.getElementById("editPollExpiresInput").value,
      10
    );
    const updateDocData = {
      question,
      options,
      expiresAt:
        expiresMin && !isNaN(expiresMin)
          ? Timestamp.fromDate(new Date(Date.now() + expiresMin * 60 * 1000))
          : null,
    };
    await setDoc(pollDocRef, updateDocData, { merge: true });
    document.getElementById("editPollModal").remove();
    showToast("Poll updated!", "success");
  };
};

// Student: Vote on poll
window.votePoll = async function (pollId, optionIdx) {
  const pollDoc = doc(db, "polls", pollId);
  const pollSnap = await getDoc(pollDoc);
  if (!pollSnap.exists()) return;
  const poll = pollSnap.data();
  if (!poll.options?.[optionIdx]) return;
  if (!poll.voters) poll.voters = [];
  if (poll.voters.includes(currentUser.uid)) return;
  poll.options[optionIdx].votes = (poll.options[optionIdx].votes || 0) + 1;
  poll.voters.push(currentUser.uid);
  await setDoc(pollDoc, poll, { merge: true });
  showToast("Vote recorded!", "success");
};

// Faculty/Admin: Delete poll
window.deletePoll = async function (pollId) {
  if (!confirm("Delete this poll?")) return;
  await deleteDoc(doc(db, "polls", pollId));
  showToast("Poll deleted!", "success");
};

// Faculty/Admin: Export poll responses (CSV, JSON, Excel)
window.exportPollResponses = async function (pollId, format) {
  const pollDoc = doc(db, "polls", pollId);
  const pollSnap = await getDoc(pollDoc);
  if (!pollSnap.exists()) return;
  const poll = pollSnap.data();
  const result = poll.options.map((opt) => ({
    Option: opt.text,
    Votes: opt.votes || 0,
  }));

  if (format === "csv") {
    const csv =
      "Option,Votes\n" +
      result.map((r) => `"${r.Option}",${r.Votes}`).join("\n");
    downloadPollExport(csv, `poll_${pollId}_responses.csv`, "text/csv");
  } else if (format === "json") {
    const json = JSON.stringify(result, null, 2);
    downloadPollExport(
      json,
      `poll_${pollId}_responses.json`,
      "application/json"
    );
  } else if (format === "excel") {
    // Excel export via SheetJS
    const worksheet = XLSX.utils.json_to_sheet(result);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "PollResults");
    const excelBuffer = XLSX.write(workbook, {
      bookType: "xlsx",
      type: "array",
    });
    const blob = new Blob([excelBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `poll_${pollId}_responses.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 3000);
  }
  showToast("Responses exported!", "success");
};

function downloadPollExport(data, filename, mime) {
  const blob = new Blob([data], { type: mime });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Expose globally
window.showPolls = showPolls;

// Event Feature - Real-time, role-based, supports Create/Edit/Delete/Export PDF/DOCX only, improved UI

// Add the closeModal function at the top
// Add the closeModal function at the top
// Global close modal function with multiple fallback methods
window.closeModal = function (modalId) {
  console.log("closeModal called with:", modalId);

  // Method 1: Try to find by ID
  const modal = document.getElementById(modalId);
  if (modal) {
    console.log("Found modal, removing...");
    modal.remove();
    return;
  }

  // Method 2: Try to find in dynamic container
  const container = document.getElementById("dynamicModalContainer");
  if (container) {
    console.log("Clearing dynamic container...");
    container.innerHTML = "";
    return;
  }

  // Method 3: Find any modal with the class structure
  const modalByClass = document.querySelector(".fixed.inset-0.z-50");
  if (modalByClass) {
    console.log("Found modal by class, removing...");
    modalByClass.remove();
    return;
  }

  console.error("No modal found to close");
};

function showEvents() {
  // Detect role from URL, fallback to "student"
  const urlParams = new URLSearchParams(window.location.search);
  const userRole = urlParams.get("role")
    ? urlParams.get("role").toLowerCase()
    : "student";
  const isFacultyOrAdmin = ["faculty", "admin"].includes(userRole);

  // Remove any existing events modal first
  document.getElementById("eventsModal")?.remove();

  // Modal container
  const modalContainer =
    document.getElementById("dynamicModalContainer") || document.body;

  const modalHTML = `
    <div id="eventsModal" class="fixed inset-0 z-50 flex items-center justify-center">
      <div class="absolute inset-0 bg-gradient-to-br from-indigo-400 via-sky-200 to-white opacity-60 backdrop-blur"></div>
      <div class="bg-white rounded-3xl w-full max-w-3xl mx-4 z-10 shadow-2xl border border-indigo-100 max-h-[85vh] overflow-y-auto relative">
        <div class="flex items-center justify-between px-6 py-5 border-b border-indigo-100 bg-indigo-50 rounded-t-3xl">
          <h2 class="text-2xl font-extrabold text-indigo-700 flex items-center gap-2"><span>📅</span> Events & Announcements</h2>
          <div class="flex items-center gap-3">
            ${
              isFacultyOrAdmin
                ? `<div class="flex gap-2">
                     <button id="createEventBtn" class="bg-gradient-to-r from-indigo-600 to-indigo-400 text-white px-4 py-2 rounded-xl shadow hover:scale-105 hover:from-indigo-700 transition text-sm font-semibold">＋ Create Event</button>
                     <button id="createAnnouncementBtn" class="bg-gradient-to-r from-green-600 to-green-400 text-white px-4 py-2 rounded-xl shadow hover:scale-105 hover:from-green-700 transition text-sm font-semibold">＋ Create Announcement</button>
                   </div>`
                : ""
            }
            <button id="closeEventsModalBtn" data-modal="eventsModal" class="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center hover:bg-indigo-200 transition text-indigo-700 font-bold text-lg cursor-pointer">✕</button>
          </div>
        </div>
        
        <!-- Tab Navigation -->
        <div class="flex border-b border-indigo-100 bg-indigo-25">
          <button id="eventsTab" class="flex-1 px-6 py-4 text-center font-semibold transition-all duration-200 border-b-2 border-indigo-500 bg-indigo-50 text-indigo-700">
            📅 Events
          </button>
          <button id="announcementsTab" class="flex-1 px-6 py-4 text-center font-semibold transition-all duration-200 border-b-2 border-transparent text-gray-500 hover:text-indigo-600 hover:bg-indigo-25">
            📢 Announcements
          </button>
        </div>
        
        <div class="px-6 py-5 bg-indigo-50 min-h-[400px]">
          <!-- Events Content -->
          <div id="eventsContent" class="tab-content">
            <div id="eventsList" class="space-y-6"></div>
          </div>
          
          <!-- Announcements Content -->
          <div id="announcementsContent" class="tab-content hidden">
            <div id="announcementsList" class="space-y-6"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  modalContainer.insertAdjacentHTML("beforeend", modalHTML);

  // Initialize tabs
  initializeTabs();

  // Add multiple event listeners for the close button
  setTimeout(() => {
    const modal = document.getElementById("eventsModal");
    const closeBtn = document.getElementById("closeEventsModalBtn");

    if (closeBtn) {
      console.log("Setting up close button listeners");

      // Method 1: Click event
      closeBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("Close button clicked via addEventListener");
        closeEventsModal();
      });

      // Method 2: Direct onclick as backup
      closeBtn.onclick = function (e) {
        e.preventDefault();
        e.stopPropagation();
        console.log("Close button clicked via onclick");
        closeEventsModal();
      };

      // Method 3: Add inline onclick as additional backup
      closeBtn.setAttribute("onclick", "closeEventsModal(); return false;");

      // Test if button is clickable
      closeBtn.style.cursor = "pointer";
      closeBtn.style.userSelect = "none";
    } else {
      console.error("Close button not found!");
    }

    // Click outside to close
    if (modal) {
      modal.addEventListener("click", (e) => {
        if (e.target === modal) {
          console.log("Clicked outside modal");
          closeEventsModal();
        }
      });
    }

    // ESC key to close
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && document.getElementById("eventsModal")) {
        console.log("ESC key pressed");
        closeEventsModal();
      }
    });
  }, 100);

  // Faculty/Admin: Create buttons
  if (isFacultyOrAdmin) {
    setTimeout(() => {
      const createEventBtn = document.getElementById("createEventBtn");
      const createAnnouncementBtn = document.getElementById(
        "createAnnouncementBtn"
      );

      if (createEventBtn) {
        createEventBtn.onclick = showCreateEventModal;
      }

      if (createAnnouncementBtn) {
        createAnnouncementBtn.onclick = showCreateAnnouncementModal;
      }
    }, 100);
  }

  // Initialize realtime listeners for both events and announcements
  initializeEventsListener();
  initializeAnnouncementsListener();

  // Tab switching functionality
  function initializeTabs() {
    const eventsTab = document.getElementById("eventsTab");
    const announcementsTab = document.getElementById("announcementsTab");
    const eventsContent = document.getElementById("eventsContent");
    const announcementsContent = document.getElementById(
      "announcementsContent"
    );

    eventsTab.onclick = () => switchTab("events");
    announcementsTab.onclick = () => switchTab("announcements");

    function switchTab(tab) {
      // Reset all tabs
      eventsTab.className =
        "flex-1 px-6 py-4 text-center font-semibold transition-all duration-200 border-b-2 border-transparent text-gray-500 hover:text-indigo-600 hover:bg-indigo-25";
      announcementsTab.className =
        "flex-1 px-6 py-4 text-center font-semibold transition-all duration-200 border-b-2 border-transparent text-gray-500 hover:text-indigo-600 hover:bg-indigo-25";

      eventsContent.className = "tab-content hidden";
      announcementsContent.className = "tab-content hidden";

      // Activate selected tab
      if (tab === "events") {
        eventsTab.className =
          "flex-1 px-6 py-4 text-center font-semibold transition-all duration-200 border-b-2 border-indigo-500 bg-indigo-50 text-indigo-700";
        eventsContent.className = "tab-content";
      } else {
        announcementsTab.className =
          "flex-1 px-6 py-4 text-center font-semibold transition-all duration-200 border-b-2 border-green-500 bg-green-50 text-green-700";
        announcementsContent.className = "tab-content";
      }
    }
  }

  // Enhanced function to initialize events listener with error handling
  function initializeEventsListener() {
    const eventsListEl = document.getElementById("eventsList");
    if (!eventsListEl) return;

    try {
      const eventsRef = collection(db, "events");
      const eventsQuery = query(eventsRef, orderBy("createdAt", "desc"));

      const unsubscribe = onSnapshot(
        eventsQuery,
        (snapshot) => {
          // Success callback
          const events = [];
          snapshot.forEach((doc) => events.push({ id: doc.id, ...doc.data() }));

          if (events.length === 0) {
            eventsListEl.innerHTML = `<div class="text-center py-12"><div class="text-6xl mb-4 animate-pulse">📅</div><p class="text-gray-500 font-semibold">No events yet</p></div>`;
            return;
          }

          eventsListEl.innerHTML = events.map(renderEventCard).join("");
        },
        (error) => {
          // Error callback
          console.error("Error fetching events:", error);

          if (error.code === "permission-denied") {
            eventsListEl.innerHTML = `
            <div class="text-center py-12">
              <div class="text-6xl mb-4">🔒</div>
              <p class="text-red-500 font-semibold mb-2">Permission Denied</p>
              <p class="text-gray-500 text-sm">You don't have permission to view events.<br>Please contact your administrator.</p>
            </div>
          `;
          } else {
            eventsListEl.innerHTML = `
            <div class="text-center py-12">
              <div class="text-6xl mb-4">⚠️</div>
              <p class="text-red-500 font-semibold mb-2">Error Loading Events</p>
              <p class="text-gray-500 text-sm">Please try refreshing the page.</p>
              <button onclick="location.reload()" class="mt-3 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">Refresh Page</button>
            </div>
          `;
          }
        }
      );

      // Store unsubscribe function for cleanup
      window.eventsUnsubscribe = unsubscribe;
    } catch (error) {
      console.error("Error setting up events listener:", error);
      eventsListEl.innerHTML = `
      <div class="text-center py-12">
        <div class="text-6xl mb-4">⚠️</div>
        <p class="text-red-500 font-semibold">Failed to initialize events</p>
      </div>
    `;
    }
  }

  // Firestore Realtime Announcements Listener
  // Enhanced function to initialize announcements listener with error handling
  function initializeAnnouncementsListener() {
    const announcementsListEl = document.getElementById("announcementsList");
    if (!announcementsListEl) return;

    try {
      const announcementsRef = collection(db, "announcements");
      const announcementsQuery = query(
        announcementsRef,
        orderBy("createdAt", "desc")
      );

      const unsubscribe = onSnapshot(
        announcementsQuery,
        (snapshot) => {
          // Success callback
          const announcements = [];
          snapshot.forEach((doc) =>
            announcements.push({ id: doc.id, ...doc.data() })
          );

          if (announcements.length === 0) {
            announcementsListEl.innerHTML = `<div class="text-center py-12"><div class="text-6xl mb-4 animate-pulse">📢</div><p class="text-gray-500 font-semibold">No announcements yet</p></div>`;
            return;
          }

          announcementsListEl.innerHTML = announcements
            .map(renderAnnouncementCard)
            .join("");
        },
        (error) => {
          // Error callback
          console.error("Error fetching announcements:", error);

          if (error.code === "permission-denied") {
            announcementsListEl.innerHTML = `
            <div class="text-center py-12">
              <div class="text-6xl mb-4">🔒</div>
              <p class="text-red-500 font-semibold mb-2">Permission Denied</p>
              <p class="text-gray-500 text-sm">You don't have permission to view announcements.<br>Please contact your administrator.</p>
            </div>
          `;
          } else {
            announcementsListEl.innerHTML = `
            <div class="text-center py-12">
              <div class="text-6xl mb-4">⚠️</div>
              <p class="text-red-500 font-semibold mb-2">Error Loading Announcements</p>
              <p class="text-gray-500 text-sm">Please try refreshing the page.</p>
              <button onclick="location.reload()" class="mt-3 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition">Refresh Page</button>
            </div>
          `;
          }
        }
      );

      // Store unsubscribe function for cleanup
      window.announcementsUnsubscribe = unsubscribe;
    } catch (error) {
      console.error("Error setting up announcements listener:", error);
      announcementsListEl.innerHTML = `
      <div class="text-center py-12">
        <div class="text-6xl mb-4">⚠️</div>
        <p class="text-red-500 font-semibold">Failed to initialize announcements</p>
      </div>
    `;
    }
  }

  // Render Event Card
  function renderEventCard(event) {
    return `
      <div class="bg-white border border-indigo-100 rounded-xl p-5 shadow-md hover:shadow-xl transition">
        <div class="flex items-start justify-between mb-4">
          <div class="flex-1">
            <h3 class="font-semibold text-indigo-700 text-lg mb-1">${
              event.title
            }</h3>
            <div class="flex items-center gap-4 text-sm text-indigo-400 font-medium">
              <span><span class="font-bold">by</span> ${
                event.authorName || "Unknown"
              }</span>
              <span>📅 ${
                event.date ? formatEventDate(event.date) : "No date"
              }</span>
              <span>⏰ ${event.time ? event.time : "No time"}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 px-3 py-1 bg-indigo-100 rounded-full shadow">
            <span class="text-xs text-indigo-700 font-semibold">${
              event.status || "Scheduled"
            }</span>
          </div>
        </div>
        <div class="mb-2 text-gray-700 whitespace-pre-line">${
          event.description || ""
        }</div>
        ${isFacultyOrAdmin ? renderEventActions(event) : ""}
      </div>
    `;
  }

  // Render Announcement Card
  function renderAnnouncementCard(announcement) {
    const priorityColors = {
      high: "bg-red-100 text-red-700 border-red-200",
      medium: "bg-yellow-100 text-yellow-700 border-yellow-200",
      low: "bg-green-100 text-green-700 border-green-200",
      normal: "bg-blue-100 text-blue-700 border-blue-200",
    };

    const priorityColor =
      priorityColors[announcement.priority] || priorityColors.normal;

    return `
      <div class="bg-white border border-green-100 rounded-xl p-5 shadow-md hover:shadow-xl transition">
        <div class="flex items-start justify-between mb-4">
          <div class="flex-1">
            <h3 class="font-semibold text-green-700 text-lg mb-1">${
              announcement.title
            }</h3>
            <div class="flex items-center gap-4 text-sm text-green-400 font-medium">
              <span><span class="font-bold">by</span> ${
                announcement.authorName || "Unknown"
              }</span>
              <span>📅 ${
                announcement.createdAt
                  ? formatAnnouncementDate(announcement.createdAt)
                  : "No date"
              }</span>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <div class="px-3 py-1 ${priorityColor} rounded-full border shadow">
              <span class="text-xs font-semibold uppercase">${
                announcement.priority || "Normal"
              } Priority</span>
            </div>
          </div>
        </div>
        <div class="mb-2 text-gray-700 whitespace-pre-line">${
          announcement.content || ""
        }</div>
        ${
          announcement.expiryDate
            ? `<div class="text-xs text-gray-500 italic mb-2">Expires: ${formatAnnouncementDate(
                announcement.expiryDate
              )}</div>`
            : ""
        }
        ${isFacultyOrAdmin ? renderAnnouncementActions(announcement) : ""}
      </div>
    `;
  }

  // Faculty/Admin Event Actions (Edit/Delete/Export)
  function renderEventActions(event) {
    return `
      <div class="flex gap-2 mt-4">
        <button onclick="showEditEventModal('${event.id}')" class="bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-200 transition">Edit</button>
        <button onclick="deleteEvent('${event.id}')" class="bg-pink-100 text-pink-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-pink-200 transition">Delete</button>
        <button onclick="exportEventInfo('${event.id}', 'pdf')" class="bg-white border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-50 transition">Export PDF</button>
        <button onclick="exportEventInfo('${event.id}', 'docx')" class="bg-white border border-indigo-200 text-indigo-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-50 transition">Export DOCX</button>
      </div>
    `;
  }

  // Faculty/Admin Announcement Actions (Edit/Delete/Export)
  function renderAnnouncementActions(announcement) {
    return `
      <div class="flex gap-2 mt-4">
        <button onclick="showEditAnnouncementModal('${announcement.id}')" class="bg-green-100 text-green-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-green-200 transition">Edit</button>
        <button onclick="deleteAnnouncement('${announcement.id}')" class="bg-pink-100 text-pink-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-pink-200 transition">Delete</button>
        <button onclick="exportAnnouncementInfo('${announcement.id}', 'pdf')" class="bg-white border border-green-200 text-green-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-green-50 transition">Export PDF</button>
        <button onclick="exportAnnouncementInfo('${announcement.id}', 'docx')" class="bg-white border border-green-200 text-green-700 px-3 py-2 rounded-lg text-xs font-semibold hover:bg-green-50 transition">Export DOCX</button>
      </div>
    `;
  }

  function formatEventDate(dateVal) {
    try {
      const d =
        typeof dateVal === "object" && dateVal.toDate
          ? dateVal.toDate()
          : new Date(dateVal);
      return d.toLocaleDateString();
    } catch {
      return dateVal;
    }
  }

  function formatAnnouncementDate(dateVal) {
    try {
      const d =
        typeof dateVal === "object" && dateVal.toDate
          ? dateVal.toDate()
          : new Date(dateVal);
      return (
        d.toLocaleDateString() +
        " " +
        d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      );
    } catch {
      return dateVal;
    }
  }
}

// Create Announcement Modal Function
function showCreateAnnouncementModal() {
  try {
    // Remove any existing modal first
    document.getElementById("createAnnouncementModal")?.remove();

    const modalContainer =
      document.getElementById("dynamicModalContainer") || document.body;

    const modalHTML = `
      <div id="createAnnouncementModal" class="fixed inset-0 z-60 flex items-center justify-center">
        <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
        <div class="bg-white rounded-2xl w-full max-w-md mx-4 z-10 shadow-2xl border border-green-200">
          <div class="flex items-center justify-between px-6 py-4 border-b border-green-100 bg-green-50 rounded-t-2xl">
            <h3 class="text-xl font-bold text-green-700">📢 Create Announcement</h3>
            <button onclick="closeCreateAnnouncementModal()" class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center hover:bg-green-200 transition text-green-700 font-bold">✕</button>
          </div>
          <form id="createAnnouncementForm" class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Announcement Title *</label>
              <input type="text" id="announcementTitle" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="Enter announcement title">
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Content *</label>
              <textarea id="announcementContent" required rows="4" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none" placeholder="Enter announcement content"></textarea>
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Priority</label>
              <select id="announcementPriority" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                <option value="normal">Normal</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Expiry Date (Optional)</label>
              <input type="date" id="announcementExpiry" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
            </div>
            
            <div class="flex gap-3 pt-2">
              <button type="submit" id="createAnnouncementBtn" class="flex-1 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold py-2 px-4 rounded-lg hover:from-green-700 hover:to-green-600 transition shadow">
                <span id="createBtnText">Create Announcement</span>
                <span id="createBtnLoader" class="hidden">Creating...</span>
              </button>
              <button type="button" onclick="closeCreateAnnouncementModal()" class="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    modalContainer.insertAdjacentHTML("beforeend", modalHTML);

    // Handle form submission with enhanced error handling
    document.getElementById("createAnnouncementForm").onsubmit =
      async function (e) {
        e.preventDefault();

        const submitBtn = document.getElementById("createAnnouncementBtn");
        const btnText = document.getElementById("createBtnText");
        const btnLoader = document.getElementById("createBtnLoader");

        // Show loading state
        submitBtn.disabled = true;
        btnText.classList.add("hidden");
        btnLoader.classList.remove("hidden");

        try {
          const title = document
            .getElementById("announcementTitle")
            .value.trim();
          const content = document
            .getElementById("announcementContent")
            .value.trim();
          const priority = document.getElementById(
            "announcementPriority"
          ).value;
          const expiryDate =
            document.getElementById("announcementExpiry").value;

          if (!title || !content) {
            throw new Error("Please fill in all required fields");
          }

          const announcementData = {
            title,
            content,
            priority,
            authorName: getCurrentUserName(),
            createdAt: new Date(),
            expiryDate: expiryDate ? new Date(expiryDate) : null,
          };

          // Check if user has permission before attempting to create
          await addDoc(collection(db, "announcements"), announcementData);

          closeCreateAnnouncementModal();
          showSuccessMessage("Announcement created successfully!");
        } catch (error) {
          console.error("Error creating announcement:", error);

          let errorMessage = "Failed to create announcement. ";

          if (error.code === "permission-denied") {
            errorMessage +=
              "You don't have permission to create announcements.";
          } else if (error.code === "network-request-failed") {
            errorMessage += "Please check your internet connection.";
          } else if (error.message) {
            errorMessage += error.message;
          } else {
            errorMessage += "Please try again.";
          }

          alert(errorMessage);
        } finally {
          // Reset loading state
          submitBtn.disabled = false;
          btnText.classList.remove("hidden");
          btnLoader.classList.add("hidden");
        }
      };

    // ESC key to close modal
    document.addEventListener("keydown", function closeOnEsc(e) {
      if (
        e.key === "Escape" &&
        document.getElementById("createAnnouncementModal")
      ) {
        closeCreateAnnouncementModal();
        document.removeEventListener("keydown", closeOnEsc);
      }
    });
  } catch (error) {
    console.error("Error showing create announcement modal:", error);
    alert("Failed to open create announcement form. Please try again.");
  }
}

// ============================================
// 1. FIX FOR MISSING closeCreateAnnouncementModal FUNCTION
// ============================================

// Add this function to your JavaScript file
function closeCreateAnnouncementModal() {
  const modal = document.getElementById("createAnnouncementModal");
  if (modal) modal.remove();
}
window.closeCreateAnnouncementModal = closeCreateAnnouncementModal;

// Additional functions you'll need to implement:

// ============================================
// 1. GET CURRENT USER NAME FUNCTION
// ============================================

function getCurrentUserName() {
  try {
    // Method 1: If using Firebase Auth
    if (typeof auth !== "undefined" && auth.currentUser) {
      return (
        auth.currentUser.displayName ||
        auth.currentUser.email?.split("@")[0] ||
        "Current User"
      );
    }

    // Method 2: If storing user info in localStorage/sessionStorage
    const userInfo =
      localStorage.getItem("userInfo") || sessionStorage.getItem("userInfo");
    if (userInfo) {
      const user = JSON.parse(userInfo);
      return (
        user.name ||
        user.displayName ||
        user.email?.split("@")[0] ||
        "Current User"
      );
    }

    // Method 3: If user info is in URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const userName = urlParams.get("userName") || urlParams.get("name");
    if (userName) {
      return decodeURIComponent(userName);
    }

    // Method 4: If user info is stored in a global variable
    if (typeof window.currentUser !== "undefined") {
      return (
        window.currentUser.name ||
        window.currentUser.displayName ||
        "Current User"
      );
    }

    // Fallback
    return "Faculty Member";
  } catch (error) {
    console.error("Error getting current user name:", error);
    return "Unknown User";
  }
}

// ============================================
// 2. EDIT ANNOUNCEMENT MODAL FUNCTION
// ============================================

async function showEditAnnouncementModal(announcementId) {
  try {
    // Remove any existing modal first
    document.getElementById("editAnnouncementModal")?.remove();

    // Fetch announcement data from Firestore
    const announcementRef = doc(db, "announcements", announcementId);
    const announcementSnap = await getDoc(announcementRef);

    if (!announcementSnap.exists()) {
      alert("Announcement not found!");
      return;
    }

    const announcementData = announcementSnap.data();

    const modalContainer =
      document.getElementById("dynamicModalContainer") || document.body;

    const modalHTML = `
      <div id="editAnnouncementModal" class="fixed inset-0 z-60 flex items-center justify-center">
        <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
        <div class="bg-white rounded-2xl w-full max-w-md mx-4 z-10 shadow-2xl border border-green-200">
          <div class="flex items-center justify-between px-6 py-4 border-b border-green-100 bg-green-50 rounded-t-2xl">
            <h3 class="text-xl font-bold text-green-700">📝 Edit Announcement</h3>
            <button onclick="closeEditAnnouncementModal()" class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center hover:bg-green-200 transition text-green-700 font-bold">✕</button>
          </div>
          <form id="editAnnouncementForm" class="p-6 space-y-4">
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Announcement Title *</label>
              <input type="text" id="editAnnouncementTitle" required class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" placeholder="Enter announcement title" value="${
                announcementData.title || ""
              }">
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Content *</label>
              <textarea id="editAnnouncementContent" required rows="4" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent resize-none" placeholder="Enter announcement content">${
                announcementData.content || ""
              }</textarea>
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Priority</label>
              <select id="editAnnouncementPriority" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent">
                <option value="normal" ${
                  announcementData.priority === "normal" ? "selected" : ""
                }>Normal</option>
                <option value="low" ${
                  announcementData.priority === "low" ? "selected" : ""
                }>Low</option>
                <option value="medium" ${
                  announcementData.priority === "medium" ? "selected" : ""
                }>Medium</option>
                <option value="high" ${
                  announcementData.priority === "high" ? "selected" : ""
                }>High</option>
              </select>
            </div>
            
            <div>
              <label class="block text-sm font-semibold text-gray-700 mb-2">Expiry Date (Optional)</label>
              <input type="date" id="editAnnouncementExpiry" class="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent" value="${formatDateForInput(
                announcementData.expiryDate
              )}">
            </div>
            
            <div class="flex gap-3 pt-2">
              <button type="submit" class="flex-1 bg-gradient-to-r from-green-600 to-green-500 text-white font-semibold py-2 px-4 rounded-lg hover:from-green-700 hover:to-green-600 transition shadow">Update Announcement</button>
              <button type="button" onclick="closeEditAnnouncementModal()" class="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition">Cancel</button>
            </div>
          </form>
        </div>
      </div>
    `;

    modalContainer.insertAdjacentHTML("beforeend", modalHTML);

    // Handle form submission
    document.getElementById("editAnnouncementForm").onsubmit = async function (
      e
    ) {
      e.preventDefault();

      const title = document
        .getElementById("editAnnouncementTitle")
        .value.trim();
      const content = document
        .getElementById("editAnnouncementContent")
        .value.trim();
      const priority = document.getElementById(
        "editAnnouncementPriority"
      ).value;
      const expiryDate = document.getElementById(
        "editAnnouncementExpiry"
      ).value;

      if (!title || !content) {
        alert("Please fill in all required fields");
        return;
      }

      try {
        const updatedData = {
          title,
          content,
          priority,
          expiryDate: expiryDate ? new Date(expiryDate) : null,
          updatedAt: new Date(),
        };

        await updateDoc(doc(db, "announcements", announcementId), updatedData);

        closeEditAnnouncementModal();
        alert("Announcement updated successfully!");
      } catch (error) {
        console.error("Error updating announcement:", error);
        alert("Failed to update announcement. Please try again.");
      }
    };
  } catch (error) {
    console.error("Error loading announcement for editing:", error);
    alert("Failed to load announcement data. Please try again.");
  }
}

function closeEditAnnouncementModal() {
  document.getElementById("editAnnouncementModal")?.remove();
}

// Helper function to format date for input field
function formatDateForInput(dateVal) {
  if (!dateVal) return "";
  try {
    const d =
      typeof dateVal === "object" && dateVal.toDate
        ? dateVal.toDate()
        : new Date(dateVal);
    return d.toISOString().split("T")[0];
  } catch {
    return "";
  }
}

// ============================================
// 3. EXPORT ANNOUNCEMENT FUNCTIONS
// ============================================

// Export as PDF
async function exportAnnouncementInfo(announcementId, format) {
  try {
    // Fetch announcement data
    const announcementRef = doc(db, "announcements", announcementId);
    const announcementSnap = await getDoc(announcementRef);

    if (!announcementSnap.exists()) {
      alert("Announcement not found!");
      return;
    }

    const announcement = announcementSnap.data();

    if (format === "pdf") {
      exportAnnouncementAsPDF(announcement, announcementId);
    } else if (format === "docx") {
      exportAnnouncementAsDOCX(announcement, announcementId);
    }
  } catch (error) {
    console.error(`Error exporting announcement as ${format}:`, error);
    alert(
      `Failed to export announcement as ${format.toUpperCase()}. Please try again.`
    );
  }
}

// Export as PDF using jsPDF
function exportAnnouncementAsPDF(announcement, announcementId) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    exportAsTextFile(announcement, announcementId, "txt");
    alert("PDF library not loaded. Exported as text file instead.");
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF("p", "mm", "a4"); // Portrait, mm units, A4

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const logoImg = new Image();
  logoImg.src = "pdf Logo.png"; // replace with your logo
  const signatureImg = new Image();
  signatureImg.src = "Signature.png"; // replace with signature

  logoImg.onload = function () {
    // Split content into lines that fit width
    const contentLines = doc.splitTextToSize(announcement.content || "", 170);
    const lineHeight = 7;
    const startY = 75;
    let currentY = startY;
    let pageNumber = 1;

    const addHeader = () => {
      doc.setFontSize(12);
      doc.setTextColor(33, 37, 41);
      doc.addImage(logoImg, "PNG", 15, 10, 30, 30); // Logo
      doc.setFontSize(20);
      doc.text("CollegeConnect", 50, 20);
      doc.setFontSize(16);
      doc.setTextColor(80, 80, 80);
      doc.text("Official Announcement", 50, 30);

      const dateStr = formatAnnouncementDate(announcement.createdAt);
      doc.setFontSize(12);
      doc.text(`Date: ${dateStr}`, 150, 15);
      doc.text(`Issued by: ${announcement.authorName}`, 150, 22);

      doc.setFillColor(102, 126, 234); // Indigo
      doc.rect(0, 40, pageWidth, 10, "F");

      // Title on first page only
      if (pageNumber === 1) {
        doc.setFontSize(16);
        doc.setTextColor(44, 62, 80);
        doc.text(`Title: ${announcement.title || "No Title"}`, 20, 60);

        // Priority badge
        let priorityColor = [100, 100, 100];
        switch ((announcement.priority || "normal").toLowerCase()) {
          case "low":
            priorityColor = [0, 128, 0];
            break;
          case "medium":
            priorityColor = [255, 165, 0];
            break;
          case "high":
            priorityColor = [255, 0, 0];
            break;
        }
        doc.setFillColor(...priorityColor);
        doc.rect(160, 55, 35, 7, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(10);
        doc.text(announcement.priority || "normal", 167, 60);
      }
    };

    const addFooter = () => {
      doc.setFontSize(10);
      doc.setTextColor(99, 102, 241);
      doc.textWithLink("https://collegeconnect.com", 20, pageHeight - 10, {
        url: "https://collegeconnect.com",
      });
    };

    // Start first page
    addHeader();
    addFooter();

    for (let i = 0; i < contentLines.length; i++) {
      if (currentY + lineHeight > pageHeight - 30) {
        // New page
        doc.addPage();
        pageNumber++;
        currentY = startY;
        addHeader();
        addFooter();
      }
      doc.setFontSize(12);
      doc.setTextColor(33, 33, 33);
      doc.text(contentLines[i], 20, currentY);
      currentY += lineHeight;
    }

    // Add signature on last page
    signatureImg.onload = function () {
      doc.addImage(
        signatureImg,
        "PNG",
        pageWidth - 55,
        pageHeight - 40,
        40,
        20
      );
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      doc.text("Authorized Signature", pageWidth - 55, pageHeight - 20);
      doc.save(`announcement_${announcementId}.pdf`);
    };
    signatureImg.onerror = function () {
      // Save PDF without signature
      doc.save(`announcement_${announcementId}.pdf`);
    };
  };

  logoImg.onerror = function () {
    alert("Logo not found. PDF generated without logo.");
    doc.text(`Title: ${announcement.title || "No Title"}`, 20, 20);
    doc.save(`announcement_${announcementId}.pdf`);
  };
}

// Export as DOCX
function exportAnnouncementAsDOCX(announcement, announcementId) {
  try {
    // For DOCX, we'll create a simple HTML document that can be opened in Word
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>Announcement - ${announcement.title}</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; max-width: 800px; margin: 0 auto; padding: 20px; }
          .header { color: #22c55e; border-bottom: 2px solid #22c55e; padding-bottom: 10px; margin-bottom: 20px; }
          .meta { color: #666; font-size: 14px; margin-bottom: 20px; }
          .priority { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
          .priority-high { background-color: #fecaca; color: #dc2626; }
          .priority-medium { background-color: #fef3c7; color: #d97706; }
          .priority-low { background-color: #dcfce7; color: #16a34a; }
          .priority-normal { background-color: #dbeafe; color: #2563eb; }
          .content { margin-top: 20px; white-space: pre-line; }
          .footer { margin-top: 30px; font-size: 12px; color: #888; border-top: 1px solid #ddd; padding-top: 10px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>📢 ANNOUNCEMENT</h1>
          <h2>${announcement.title || "Untitled Announcement"}</h2>
        </div>
        
        <div class="meta">
          <p><strong>By:</strong> ${announcement.authorName || "Unknown"}</p>
          <p><strong>Created:</strong> ${formatAnnouncementDate(
            announcement.createdAt
          )}</p>
          <p><strong>Priority:</strong> <span class="priority priority-${
            announcement.priority || "normal"
          }">${(announcement.priority || "normal").toUpperCase()}</span></p>
          ${
            announcement.expiryDate
              ? `<p><strong>Expires:</strong> ${formatAnnouncementDate(
                  announcement.expiryDate
                )}</p>`
              : ""
          }
        </div>
        
        <div class="content">
          <h3>Content:</h3>
          <p>${announcement.content || "No content available"}</p>
        </div>
        
        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
        </div>
      </body>
      </html>
    `;

    // Create blob and download
    const blob = new Blob([htmlContent], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `announcement_${
      announcement.title?.replace(/[^a-zA-Z0-9]/g, "_") || announcementId
    }.docx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Error creating DOCX:", error);
    // Fallback to text export
    exportAsTextFile(announcement, announcementId, "txt");
    alert("Error creating DOCX. Exported as text file instead.");
  }
}

// Fallback text export
function exportAsTextFile(announcement, announcementId, extension) {
  const content = `
ANNOUNCEMENT
============

Title: ${announcement.title || "Untitled Announcement"}
By: ${announcement.authorName || "Unknown"}
Created: ${formatAnnouncementDate(announcement.createdAt)}
Priority: ${(announcement.priority || "normal").toUpperCase()}
${
  announcement.expiryDate
    ? `Expires: ${formatAnnouncementDate(announcement.expiryDate)}`
    : ""
}

Content:
--------
${announcement.content || "No content available"}

Generated on ${new Date().toLocaleString()}
  `;

  const blob = new Blob([content], { type: "text/plain" });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `announcement_${
    announcement.title?.replace(/[^a-zA-Z0-9]/g, "_") || announcementId
  }.${extension}`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

// ============================================
// 4. ENHANCED DELETE FUNCTION WITH CONFIRMATION
// ============================================

async function deleteAnnouncement(announcementId) {
  // Create custom confirmation modal
  const confirmModal = `
    <div id="deleteConfirmModal" class="fixed inset-0 z-70 flex items-center justify-center">
      <div class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"></div>
      <div class="bg-white rounded-2xl w-full max-w-sm mx-4 z-10 shadow-2xl border border-red-200">
        <div class="p-6 text-center">
          <div class="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <span class="text-2xl">🗑️</span>
          </div>
          <h3 class="text-lg font-bold text-gray-800 mb-2">Delete Announcement</h3>
          <p class="text-gray-600 mb-6">Are you sure you want to delete this announcement? This action cannot be undone.</p>
          <div class="flex gap-3">
            <button onclick="confirmDeleteAnnouncement('${announcementId}')" class="flex-1 bg-red-600 text-white font-semibold py-2 px-4 rounded-lg hover:bg-red-700 transition">Delete</button>
            <button onclick="closeDeleteConfirmModal()" class="flex-1 bg-gray-200 text-gray-700 font-semibold py-2 px-4 rounded-lg hover:bg-gray-300 transition">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", confirmModal);
}

async function confirmDeleteAnnouncement(announcementId) {
  try {
    await deleteDoc(doc(db, "announcements", announcementId));
    closeDeleteConfirmModal();

    // Show success message
    showSuccessMessage("Announcement deleted successfully!");
  } catch (error) {
    console.error("Error deleting announcement:", error);
    closeDeleteConfirmModal();
    alert("Failed to delete announcement. Please try again.");
  }
}

function closeDeleteConfirmModal() {
  document.getElementById("deleteConfirmModal")?.remove();
}

// ============================================
// 5. SUCCESS MESSAGE FUNCTION
// ============================================

function showSuccessMessage(message) {
  // Remove any existing success message
  document.getElementById("successMessage")?.remove();

  const successModal = `
    <div id="successMessage" class="fixed top-4 right-4 z-80 transform transition-all duration-300">
      <div class="bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg flex items-center gap-2">
        <span class="text-lg">✅</span>
        <span class="font-medium">${message}</span>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", successModal);

  // Auto remove after 3 seconds
  setTimeout(() => {
    const element = document.getElementById("successMessage");
    if (element) {
      element.style.transform = "translateX(100%)";
      element.style.opacity = "0";
      setTimeout(() => element.remove(), 300);
    }
  }, 3000);
}

// ============================================
// 6. UTILITY FUNCTIONS
// ============================================

// Format announcement date (used in multiple places)
function formatAnnouncementDate(dateVal) {
  try {
    const d =
      typeof dateVal === "object" && dateVal.toDate
        ? dateVal.toDate()
        : new Date(dateVal);
    return (
      d.toLocaleDateString() +
      " " +
      d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    );
  } catch {
    return dateVal || "No date";
  }
}

// ============================================
// 7. OPTIONAL: BULK OPERATIONS
// ============================================

// Bulk delete expired announcements
async function cleanupExpiredAnnouncements() {
  try {
    const announcementsRef = collection(db, "announcements");
    const now = new Date();
    const expiredQuery = query(
      announcementsRef,
      where("expiryDate", "<=", now)
    );

    const snapshot = await getDocs(expiredQuery);
    const deletePromises = [];

    snapshot.forEach((doc) => {
      deletePromises.push(deleteDoc(doc.ref));
    });

    await Promise.all(deletePromises);

    if (deletePromises.length > 0) {
      showSuccessMessage(
        `${deletePromises.length} expired announcement(s) cleaned up!`
      );
    }
  } catch (error) {
    console.error("Error cleaning up expired announcements:", error);
  }
}

// Faculty/Admin: Create Event Modal
function showCreateEventModal() {
  document.getElementById("createEventModal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="createEventModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center" style="z-index:99999;">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 mx-4 border border-indigo-100" style="z-index:100000;">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-indigo-700 flex items-center gap-2">
            <span>📅</span> Create Event
          </h2>
          <button onclick="document.getElementById('createEventModal').remove()" class="w-8 h-8 bg-indigo-100 rounded-full hover:bg-indigo-200 flex items-center justify-center text-indigo-700 font-bold">✕</button>
        </div>
        <form id="createEventForm" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Event Title *</label>
            <input type="text" id="eventTitleInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" required placeholder="E.g. Seminar on AI">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Description</label>
            <textarea id="eventDescriptionInput" rows="3" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Details about the event"></textarea>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Date *</label>
            <input type="date" id="eventDateInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" required>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Time</label>
            <input type="time" id="eventTimeInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Status</label>
            <input type="text" id="eventStatusInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" placeholder="Scheduled/Cancelled">
          </div>
          <div class="flex gap-3 mt-4">
            <button type="button" onclick="document.getElementById('createEventModal').remove()" class="flex-1 bg-indigo-100 text-indigo-700 py-3 rounded-lg hover:bg-indigo-200 font-semibold">Cancel</button>
            <button type="submit" class="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-400 text-white py-3 rounded-lg hover:from-indigo-700 font-semibold">＋ Create Event</button>
          </div>
        </form>
      </div>
    </div>
    `
  );
  document.getElementById("createEventForm").onsubmit = async function (e) {
    e.preventDefault();
    const title = document.getElementById("eventTitleInput").value.trim();
    const description = document
      .getElementById("eventDescriptionInput")
      .value.trim();
    const date = document.getElementById("eventDateInput").value;
    const time = document.getElementById("eventTimeInput").value;
    const status =
      document.getElementById("eventStatusInput").value.trim() || "Scheduled";
    if (!title || !date) {
      showToast("Title and Date are required.", "error");
      return;
    }
    const eventDoc = {
      title,
      description,
      date: date,
      time: time,
      status,
      authorId: currentUser.uid,
      authorName:
        currentUserData?.fullName || currentUserData?.displayName || "Unknown",
      createdAt: serverTimestamp(),
    };
    await addDoc(collection(db, "events"), eventDoc);
    document.getElementById("createEventModal").remove();
    showToast("Event created!", "success");
  };
}

// Faculty/Admin: Edit Event Modal
window.showEditEventModal = async function (eventId) {
  const eventDocRef = doc(db, "events", eventId);
  const eventSnap = await getDoc(eventDocRef);
  if (!eventSnap.exists()) return showToast("Event not found", "error");
  const event = eventSnap.data();

  document.getElementById("editEventModal")?.remove();
  document.body.insertAdjacentHTML(
    "beforeend",
    `
    <div id="editEventModal" class="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center" style="z-index:100000;">
      <div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 mx-4 border border-indigo-100" style="z-index:100001;">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-indigo-700 flex items-center gap-2">
            <span>📅</span> Edit Event
          </h2>
          <button onclick="document.getElementById('editEventModal').remove()" class="w-8 h-8 bg-indigo-100 rounded-full hover:bg-indigo-200 flex items-center justify-center text-indigo-700 font-bold">✕</button>
        </div>
        <form id="editEventForm" class="space-y-4">
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Event Title *</label>
            <input type="text" id="editEventTitleInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" required value="${
              event.title
            }">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Description</label>
            <textarea id="editEventDescriptionInput" rows="3" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400">${
              event.description || ""
            }</textarea>
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Date *</label>
            <input type="date" id="editEventDateInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" required value="${
              event.date
            }">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Time</label>
            <input type="time" id="editEventTimeInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" value="${
              event.time || ""
            }">
          </div>
          <div>
            <label class="block text-sm font-semibold mb-2 text-indigo-700">Status</label>
            <input type="text" id="editEventStatusInput" class="w-full p-3 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400" value="${
              event.status || "Scheduled"
            }">
          </div>
          <div class="flex gap-3 mt-4">
            <button type="button" onclick="document.getElementById('editEventModal').remove()" class="flex-1 bg-indigo-100 text-indigo-700 py-3 rounded-lg hover:bg-indigo-200 font-semibold">Cancel</button>
            <button type="submit" class="flex-1 bg-gradient-to-r from-indigo-600 to-indigo-400 text-white py-3 rounded-lg hover:from-indigo-700 font-semibold">Save Changes</button>
          </div>
        </form>
      </div>
    </div>
    `
  );

  document.getElementById("editEventForm").onsubmit = async function (e) {
    e.preventDefault();
    const title = document.getElementById("editEventTitleInput").value.trim();
    const description = document
      .getElementById("editEventDescriptionInput")
      .value.trim();
    const date = document.getElementById("editEventDateInput").value;
    const time = document.getElementById("editEventTimeInput").value;
    const status =
      document.getElementById("editEventStatusInput").value.trim() ||
      "Scheduled";
    if (!title || !date) {
      showToast("Title and Date are required.", "error");
      return;
    }
    const updateDocData = {
      title,
      description,
      date,
      time,
      status,
    };
    await setDoc(eventDocRef, updateDocData, { merge: true });
    document.getElementById("editEventModal").remove();
    showToast("Event updated!", "success");
  };
};

// Faculty/Admin: Delete event
window.deleteEvent = async function (eventId) {
  if (!confirm("Delete this event?")) return;
  await deleteDoc(doc(db, "events", eventId));
  showToast("Event deleted!", "success");
};

// Faculty/Admin: Export event info (PDF, DOCX only)
// Requires jsPDF and docx libraries loaded in your project.
// jsPDF: https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js
// docx: https://cdnjs.cloudflare.com/ajax/libs/docx/7.7.0/docx.umd.min.js
window.exportEventInfo = async function (eventId, format) {
  const eventDoc = doc(db, "events", eventId);
  const eventSnap = await getDoc(eventDoc);
  if (!eventSnap.exists()) return;
  const event = eventSnap.data();
  const result = {
    Title: event.title,
    Description: event.description || "",
    Date: event.date || "",
    Time: event.time || "",
    Status: event.status || "",
    Author: event.authorName || "",
  };

  if (format === "pdf") {
    // Export to PDF using jsPDF
    const doc = new window.jspdf.jsPDF();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.text("Event Information", 15, 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(12);
    doc.text(`Title: ${result.Title}`, 15, 35);
    doc.text(`Description: ${result.Description}`, 15, 45, { maxWidth: 170 });
    doc.text(`Date: ${result.Date}`, 15, 60);
    doc.text(`Time: ${result.Time}`, 15, 70);
    doc.text(`Status: ${result.Status}`, 15, 80);
    doc.text(`Author: ${result.Author}`, 15, 90);
    doc.save(`event_${eventId}_info.pdf`);
  } else if (format === "docx") {
    // Export to DOCX using docx library
    const { Document, Packer, Paragraph, TextRun } = window.docx;
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: "Event Information",
                  bold: true,
                  size: 32,
                }),
              ],
              spacing: { after: 200 },
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Title: ${result.Title}`, bold: true }),
              ],
            }),
            new Paragraph({
              children: [
                new TextRun({ text: `Description: ${result.Description}` }),
              ],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Date: ${result.Date}` })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Time: ${result.Time}` })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Status: ${result.Status}` })],
            }),
            new Paragraph({
              children: [new TextRun({ text: `Author: ${result.Author}` })],
            }),
          ],
        },
      ],
    });
    Packer.toBlob(doc).then((blob) => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `event_${eventId}_info.docx`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 3000);
    });
  }
  showToast("Event info exported!", "success");
};

// Example modal for export (call this from your UI)
function showExportAnnouncementModal(announcement) {
  document.getElementById("exportAnnouncementModal")?.remove();
  const modal = document.createElement("div");
  modal.id = "exportAnnouncementModal";
  modal.className =
    "fixed inset-0 z-[99999] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/40" onclick="document.getElementById('exportAnnouncementModal').remove()"></div>
    <div class="relative bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-6">
      <h2 class="text-lg font-bold mb-4">Export Announcement</h2>
      <div class="space-y-2 mb-4">
        <div><strong>Title:</strong> ${announcement.title || ""}</div>
        <div><strong>Description:</strong> ${
          announcement.description || ""
        }</div>
        <div><strong>Date:</strong> ${announcement.date || ""}</div>
        <div><strong>Author:</strong> ${announcement.author || ""}</div>
      </div>
      <div class="flex gap-4">
        <button onclick="exportAnnouncementInfo(window._exportAnnouncement, 'csv')" class="px-4 py-2 bg-blue-600 text-white rounded">Export CSV</button>
        <button onclick="exportAnnouncementInfo(window._exportAnnouncement, 'json')" class="px-4 py-2 bg-green-600 text-white rounded">Export JSON</button>
        <button onclick="exportAnnouncementInfo(window._exportAnnouncement, 'pdf')" class="px-4 py-2 bg-indigo-600 text-white rounded">Export PDF</button>
      </div>
      <button onclick="document.getElementById('exportAnnouncementModal').remove()" class="absolute top-3 right-3 w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center font-bold text-gray-600">✕</button>
    </div>
  `;
  document.body.appendChild(modal);
  // Save current announcement for export buttons
  window._exportAnnouncement = announcement;
}

// Example usage:
// showExportAnnouncementModal({ id: "123", title: "Seminar", description: "ML Seminar", date: "2025-08-16", author: "Admin" });

window.exportAnnouncementInfo = exportAnnouncementInfo;
window.showExportAnnouncementModal = showExportAnnouncementModal;

// Expose globally
window.showEvents = showEvents;

// Enhanced Feature Implementations
async function loadTimetable() {
  const timetableContent = document.getElementById("timetableContent");
  if (!timetableContent) return;

  try {
    // Use simple query to avoid index requirement
    const timetableQuery = query(
      collection(db, "timetable"),
      orderBy("createdAt", "desc") // Use a simple field that exists
    );

    const timetableSnapshot = await getDocs(timetableQuery);
    const timetableData = timetableSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (timetableData.length === 0) {
      timetableContent.innerHTML = `
        <div class="text-center py-12">
          <div class="text-6xl mb-4">📅</div>
          <p class="text-gray-500">No classes scheduled</p>
          ${
            hasPermission("canCreateTimetable")
              ? '<p class="text-sm text-gray-400 mt-2">Add the first class to get started!</p>'
              : ""
          }
        </div>
      `;
      return;
    }

    // Group by day
    const days = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    const dayLabels = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];

    const groupedData = days.map((day, index) => ({
      day: dayLabels[index],
      dayKey: day,
      classes: timetableData.filter(
        (item) => item.dayOfWeek === day || item.day === day
      ),
    }));

    timetableContent.innerHTML = `
      <div class="grid md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        ${groupedData
          .map(
            (dayData) => `
          <div class="bg-gray-50 rounded-xl p-4">
            <h3 class="font-bold text-center mb-4 text-gray-800 text-lg">${
              dayData.day
            }</h3>
            <div class="space-y-3">
              ${
                dayData.classes.length > 0
                  ? dayData.classes
                      .map(
                        (cls) => `
                <div class="bg-white rounded-lg p-3 border hover:border-indigo-300 transition-colors">
                  <div class="flex items-center justify-between mb-2">
                    <div class="font-semibold text-gray-800 text-sm">${
                      cls.subject || "Unknown Subject"
                    }</div>
                    <div class="text-xs text-indigo-600 font-medium">${
                      cls.startTime
                    } - ${cls.endTime}</div>
                  </div>
                  <div class="text-xs text-gray-600">
                    <div>📍 ${cls.room || "TBA"}</div>
                    <div>👨‍🏫 ${cls.instructor || cls.faculty || "TBA"}</div>
                  </div>
                  ${
                    hasPermission("canCreateTimetable")
                      ? `
                    <div class="flex gap-2 mt-3">
                      <button onclick="editTimetableEntry('${cls.id}')" class="flex-1 bg-blue-50 text-blue-600 py-1 px-2 rounded text-xs hover:bg-blue-100 transition-colors">
                        ✏️ Edit
                      </button>
                      <button onclick="deleteTimetableEntry('${cls.id}')" class="bg-red-50 text-red-600 py-1 px-2 rounded text-xs hover:bg-red-100 transition-colors">
                        🗑️
                      </button>
                    </div>
                  `
                      : ""
                  }
                </div>
              `
                      )
                      .join("")
                  : `
                <div class="text-center py-8 text-gray-400">
                  <div class="text-2xl mb-2">🔴</div>
                  <div class="text-sm">No classes</div>
                </div>
              `
              }
            </div>
          </div>
        `
          )
          .join("")}
      </div>
    `;
  } catch (error) {
    console.error("Error loading timetable:", error);
    timetableContent.innerHTML = `
      <div class="text-center py-12">
        <div class="text-6xl mb-4">❌</div>
        <p class="text-red-500">Error loading timetable</p>
        <p class="text-sm text-gray-500 mt-2">Please check your database configuration</p>
      </div>
    `;
  }
}

async function loadPolls() {
  const pollsContent = document.getElementById("pollsContent");
  if (!pollsContent) return;

  try {
    const pollsQuery = query(
      collection(db, "polls"),
      orderBy("createdAt", "desc"),
      limit(20)
    );

    const pollsSnapshot = await getDocs(pollsQuery);
    const polls = pollsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (polls.length === 0) {
      pollsContent.innerHTML = `
        <div class="text-center py-12">
          <div class="text-6xl mb-4">📊</div>
          <p class="text-gray-500">No polls available</p>
          ${
            hasPermission("canCreatePolls")
              ? '<p class="text-sm text-gray-400 mt-2">Create the first poll to engage with your community!</p>'
              : ""
          }
        </div>
      `;
      return;
    }

    pollsContent.innerHTML = polls
      .map((poll) => {
        const totalVotes = poll.options
          ? poll.options.reduce((sum, option) => sum + (option.votes || 0), 0)
          : 0;
        const hasVoted = poll.voters && poll.voters.includes(currentUser?.uid);
        const isExpired =
          poll.expiresAt && poll.expiresAt.toDate() < new Date();

        return `
        <div class="bg-white border border-gray-200 rounded-xl p-6 hover:border-indigo-300 transition-colors">
          <div class="flex items-start justify-between mb-4">
            <div class="flex-1">
              <h3 class="font-semibold text-gray-800 mb-2 text-lg">${
                poll.question
              }</h3>
              <div class="flex items-center gap-4 text-sm text-gray-500">
                <span>👨‍🏫 ${poll.authorName}</span>
                <span>📅 ${formatTimeAgo(poll.createdAt)}</span>
                <span>👥 ${totalVotes} votes</span>
                ${
                  poll.expiresAt
                    ? `<span>⏰ ${
                        isExpired
                          ? "Expired"
                          : "Expires " + formatTimeAgo(poll.expiresAt)
                      }</span>`
                    : ""
                }
              </div>
            </div>
            <div class="flex items-center gap-2 px-3 py-1 ${
              isExpired ? "bg-red-50" : "bg-green-50"
            } rounded-full">
              <div class="w-2 h-2 ${
                isExpired ? "bg-red-500" : "bg-green-500"
              } rounded-full ${!isExpired ? "animate-pulse" : ""}"></div>
              <span class="text-xs ${
                isExpired ? "text-red-700" : "text-green-700"
              } font-medium">${isExpired ? "Ended" : "Live"}</span>
            </div>
          </div>
          
          <div class="space-y-3">
            ${
              poll.options
                ? poll.options
                    .map((option, index) => {
                      const percentage =
                        totalVotes > 0
                          ? Math.round(((option.votes || 0) / totalVotes) * 100)
                          : 0;
                      const isHighest = poll.options.every(
                        (opt) => (option.votes || 0) >= (opt.votes || 0)
                      );

                      return `
                <div class="group ${
                  !isExpired && !hasVoted ? "cursor-pointer" : ""
                }" onclick="${
                        !isExpired && !hasVoted
                          ? `votePoll('${poll.id}', ${index})`
                          : ""
                      }">
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700">${
                      option.text
                    }</span>
                    <span class="text-sm text-gray-500">${
                      option.votes || 0
                    } votes (${percentage}%)</span>
                  </div>
                  <div class="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div class="h-full ${
                      isHighest && percentage > 0
                        ? "bg-indigo-500"
                        : "bg-gray-400"
                    } rounded-full transition-all duration-500 ${
                        !isExpired && !hasVoted
                          ? "group-hover:bg-indigo-600"
                          : ""
                      }" 
                         style="width: ${percentage}%"></div>
                  </div>
                </div>
              `;
                    })
                    .join("")
                : '<p class="text-gray-500">No options available</p>'
            }
          </div>
          
          ${
            hasVoted
              ? `
            <div class="mt-4 flex items-center gap-2 text-sm text-green-600">
              <span>✅</span>
              <span>You have voted in this poll</span>
            </div>
          `
              : ""
          }
          
          ${
            hasPermission("canDeletePolls") &&
            poll.authorId === currentUser?.uid
              ? `
            <div class="mt-4 pt-4 border-t border-gray-100">
              <button onclick="deletePoll('${poll.id}')" class="text-red-600 hover:text-red-800 text-sm font-medium">
                🗑️ Delete Poll
              </button>
            </div>
          `
              : ""
          }
        </div>
      `;
      })
      .join("");
  } catch (error) {
    console.error("Error loading polls:", error);
    pollsContent.innerHTML = `
      <div class="text-center py-12">
        <div class="text-6xl mb-4">❌</div>
        <p class="text-red-500">Error loading polls</p>
      </div>
    `;
  }
}

async function loadEvents() {
  const eventsContent = document.getElementById("eventsContent");
  if (!eventsContent) return;

  try {
    const eventsQuery = query(
      collection(db, "events"),
      orderBy("eventDate", "desc"),
      limit(20)
    );

    const eventsSnapshot = await getDocs(eventsQuery);
    const events = eventsSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
    }));

    if (events.length === 0) {
      eventsContent.innerHTML = `
        <div class="text-center py-12">
          <div class="text-6xl mb-4">🎉</div>
          <p class="text-gray-500">No events scheduled</p>
          ${
            hasPermission("canCreateEvents")
              ? '<p class="text-sm text-gray-400 mt-2">Create the first event to get started!</p>'
              : ""
          }
        </div>
      `;
      return;
    }

    eventsContent.innerHTML = `
      <div class="grid md:grid-cols-2 gap-6">
        ${events
          .map((event) => {
            const eventDate = event.eventDate.toDate();
            const isUpcoming = eventDate > new Date();
            const isPast = eventDate < new Date();

            return `
            <div class="bg-white border border-gray-200 rounded-xl p-6 hover:border-indigo-300 transition-colors">
              <div class="flex items-start justify-between mb-4">
                <div class="flex-1">
                  <h3 class="font-bold text-gray-800 mb-2 text-lg">${
                    event.title
                  }</h3>
                  <p class="text-gray-600 text-sm mb-3">${
                    event.description || "No description"
                  }</p>
                </div>
                <div class="flex items-center gap-2 px-3 py-1 ${
                  isUpcoming
                    ? "bg-blue-50"
                    : isPast
                    ? "bg-gray-50"
                    : "bg-green-50"
                } rounded-full">
                  <span class="text-xs ${
                    isUpcoming
                      ? "text-blue-700"
                      : isPast
                      ? "text-gray-600"
                      : "text-green-700"
                  } font-medium">
                    ${isUpcoming ? "Upcoming" : isPast ? "Past" : "Today"}
                  </span>
                </div>
              </div>
              
              <div class="space-y-2 text-sm text-gray-600">
                <div class="flex items-center gap-2">
                  <span>📅</span>
                  <span>${eventDate.toLocaleDateString()} at ${eventDate.toLocaleTimeString(
              [],
              { hour: "2-digit", minute: "2-digit" }
            )}</span>
                </div>
                ${
                  event.location
                    ? `
                  <div class="flex items-center gap-2">
                    <span>📍</span>
                    <span>${event.location}</span>
                  </div>
                `
                    : ""
                }
                <div class="flex items-center gap-2">
                  <span>👨‍🏫</span>
                  <span>Organized by ${event.organizerName}</span>
                </div>
                ${
                  event.attendees
                    ? `
                  <div class="flex items-center gap-2">
                    <span>👥</span>
                    <span>${event.attendees.length} attendees</span>
                  </div>
                `
                    : ""
                }
              </div>
              
              <div class="mt-4 pt-4 border-t border-gray-100">
                <div class="flex gap-2">
                  ${
                    isUpcoming && !event.attendees?.includes(currentUser?.uid)
                      ? `
                    <button onclick="joinEvent('${event.id}')" class="flex-1 bg-indigo-50 text-indigo-600 py-2 px-4 rounded-lg hover:bg-indigo-100 transition-colors font-medium text-sm">
                      ✋ Join Event
                    </button>
                  `
                      : event.attendees?.includes(currentUser?.uid)
                      ? `
                    <button onclick="leaveEvent('${event.id}')" class="flex-1 bg-green-50 text-green-600 py-2 px-4 rounded-lg hover:bg-green-100 transition-colors font-medium text-sm">
                      ✅ Joined
                    </button>
                  `
                      : ""
                  }
                  
                  ${
                    hasPermission("canDeleteEvents") &&
                    event.organizerId === currentUser?.uid
                      ? `
                    <button onclick="deleteEvent('${event.id}')" class="bg-red-50 text-red-600 py-2 px-4 rounded-lg hover:bg-red-100 transition-colors font-medium text-sm">
                      🗑️ Delete
                    </button>
                  `
                      : ""
                  }
                </div>
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
    `;
  } catch (error) {
    console.error("Error loading events:", error);
    eventsContent.innerHTML = `
      <div class="text-center py-12">
        <div class="text-6xl mb-4">❌</div>
        <p class="text-red-500">Error loading events</p>
      </div>
    `;
  }
}

// Modal close functions
function closeTimetableModal() {
  const modal = document.getElementById("timetableModal");
  if (modal) modal.remove();
}

function closePollsModal() {
  const modal = document.getElementById("pollsModal");
  if (modal) modal.remove();
}

// Function to cleanup listeners when modal is closed
function closeEventsModal() {
  try {
    // Unsubscribe from Firestore listeners
    if (window.eventsUnsubscribe) {
      window.eventsUnsubscribe();
      window.eventsUnsubscribe = null;
    }

    if (window.announcementsUnsubscribe) {
      window.announcementsUnsubscribe();
      window.announcementsUnsubscribe = null;
    }

    // Remove modal
    const modal = document.getElementById("eventsModal");
    if (modal) {
      modal.remove();
    }

    console.log("Events modal closed and listeners cleaned up");
  } catch (error) {
    console.error("Error closing events modal:", error);
  }
}

// Timetable Management Functions
function createTimetableEntry() {
  if (!hasPermission("canCreateTimetable")) {
    showToast(
      "You do not have permission to create timetable entries",
      "error"
    );
    return;
  }

  const modal = document.getElementById("addClassModal");
  if (modal) {
    modal.classList.remove("hidden");
  }
}

async function editTimetableEntry(entryId) {
  if (!hasPermission("canCreateTimetable")) {
    showToast("You do not have permission to edit timetable entries", "error");
    return;
  }

  try {
    const entryRef = doc(db, "timetable", entryId);
    const entrySnap = await getDoc(entryRef);

    if (entrySnap.exists()) {
      const entry = entrySnap.data();

      // Populate the form with existing data
      document.getElementById("classDay").value =
        entry.dayOfWeek || entry.day || "monday";
      document.getElementById("classStartTime").value = entry.startTime || "";
      document.getElementById("classEndTime").value = entry.endTime || "";
      document.getElementById("classSubject").value = entry.subject || "";
      document.getElementById("classRoom").value = entry.room || "";
      document.getElementById("classInstructor").value =
        entry.instructor || entry.faculty || "";

      // Show the modal
      const modal = document.getElementById("addClassModal");
      if (modal) {
        modal.classList.remove("hidden");

        // Change the save button to update mode
        const saveBtn = document.getElementById("saveClassBtn");
        saveBtn.textContent = "Update Class";
        saveBtn.setAttribute("data-edit-id", entryId);
      }
    } else {
      showToast("Timetable entry not found", "error");
    }
  } catch (error) {
    console.error("Error loading timetable entry:", error);
    showToast("Error loading entry details", "error");
  }
}

async function deleteTimetableEntry(entryId) {
  if (!hasPermission("canCreateTimetable")) {
    showToast(
      "You do not have permission to delete timetable entries",
      "error"
    );
    return;
  }

  if (!confirm("Are you sure you want to delete this class?")) {
    return;
  }

  try {
    await deleteDoc(doc(db, "timetable", entryId));
    showToast("Class deleted successfully", "success");
    loadTimetable(); // Refresh timetable
  } catch (error) {
    console.error("Error deleting timetable entry:", error);
    showToast("Failed to delete class. Please try again.", "error");
  }
}

// Interactive Functions
async function votePoll(pollId, optionIndex) {
  if (!hasPermission("canVotePolls")) {
    showToast("You do not have permission to vote", "error");
    return;
  }

  try {
    const pollRef = doc(db, "polls", pollId);
    const pollSnap = await getDoc(pollRef);

    if (pollSnap.exists()) {
      const poll = pollSnap.data();

      // Check if user already voted
      if (poll.voters && poll.voters.includes(currentUser.uid)) {
        showToast("You have already voted in this poll", "warning");
        return;
      }

      // Check if poll is expired
      if (poll.expiresAt && poll.expiresAt.toDate() < new Date()) {
        showToast("This poll has expired", "warning");
        return;
      }

      // Update vote count
      const updatedOptions = [...poll.options];
      updatedOptions[optionIndex].votes =
        (updatedOptions[optionIndex].votes || 0) + 1;

      const updatedVoters = [...(poll.voters || []), currentUser.uid];

      await updateDoc(pollRef, {
        options: updatedOptions,
        voters: updatedVoters,
      });

      showToast("Vote recorded successfully!", "success");
      loadPolls(); // Refresh polls
    } else {
      showToast("Poll not found", "error");
    }
  } catch (error) {
    console.error("Error voting:", error);
    showToast("Failed to record vote. Please try again.", "error");
  }
}

async function joinEvent(eventId) {
  try {
    const eventRef = doc(db, "events", eventId);
    const eventSnap = await getDoc(eventRef);

    if (eventSnap.exists()) {
      const event = eventSnap.data();
      const attendees = event.attendees || [];

      if (!attendees.includes(currentUser.uid)) {
        await updateDoc(eventRef, {
          attendees: [...attendees, currentUser.uid],
        });

        showToast("Successfully joined the event!", "success");
        loadEvents(); // Refresh events
      } else {
        showToast("You are already registered for this event", "warning");
      }
    } else {
      showToast("Event not found", "error");
    }
  } catch (error) {
    console.error("Error joining event:", error);
    showToast("Failed to join event. Please try again.", "error");
  }
}

async function leaveEvent(eventId) {
  try {
    const eventRef = doc(db, "events", eventId);
    const eventSnap = await getDoc(eventRef);

    if (eventSnap.exists()) {
      const event = eventSnap.data();
      const attendees = event.attendees || [];

      const updatedAttendees = attendees.filter(
        (uid) => uid !== currentUser.uid
      );

      await updateDoc(eventRef, {
        attendees: updatedAttendees,
      });

      showToast("Left the event successfully", "success");
      loadEvents(); // Refresh events
    } else {
      showToast("Event not found", "error");
    }
  } catch (error) {
    console.error("Error leaving event:", error);
    showToast("Failed to leave event. Please try again.", "error");
  }
}

// Placeholder functions for missing features
/*function createPoll() {
  showToast("Create Poll feature coming soon!", "info");
}

function deletePoll(pollId) {
  showToast("Delete Poll feature coming soon!", "info");
}*/

function createEvent() {
  showToast("Create Event feature coming soon!", "info");
}

function deleteEvent(eventId) {
  showToast("Delete Event feature coming soon!", "info");
}

// User interaction functions
function toggleUserDropdown() {
  const dropdown = document.getElementById("userDropdown");
  if (dropdown) {
    dropdown.classList.toggle("hidden");
  }
}

function showProfile() {
  showModal("profileModal");
  loadProfileData();
}

function changePassword() {
  showToast(
    "Password change feature will be implemented with proper authentication!",
    "info"
  );
}

async function handleLogout() {
  try {
    // Clean up listeners
    if (chatUnsubscribe) chatUnsubscribe();
    if (filesUnsubscribe) filesUnsubscribe();
    if (eventsUnsubscribe) eventsUnsubscribe();
    if (pollsUnsubscribe) pollsUnsubscribe();

    realTimeListeners.forEach((unsubscribe) => {
      if (typeof unsubscribe === "function") {
        unsubscribe();
      }
    });
    realTimeListeners.clear();

    await signOut(auth);

    currentUser = null;
    currentUserData = null;

    showToast("Logged out successfully", "success");
    window.location.href = "index.html";
  } catch (error) {
    console.error("Logout error:", error);
    showToast("Error signing out", "error");
    // Force redirect anyway
    window.location.href = "index.html";
  }
}

// Utility Functions
function showToastWithIcon(message, type = "info", duration = 3000) {
  console.log(`[${type.toUpperCase()}] ${message}`);

  // Remove existing toast if present
  const existingToast = document.getElementById("customToast");
  if (existingToast) existingToast.remove();

  const colors = {
    success: "bg-green-500 border-green-400",
    error: "bg-red-500 border-red-400",
    info: "bg-blue-500 border-blue-400",
    warning: "bg-yellow-500 border-yellow-400",
  };

  const icons = {
    success: "✓",
    error: "✕",
    info: "ℹ",
    warning: "⚠",
  };

  // Create toast
  const toast = document.createElement("div");
  toast.id = "customToast";
  toast.className = `fixed top-4 right-4 ${colors[type] || colors.info} 
                     text-white px-6 py-4 rounded-lg shadow-lg z-[10000] 
                     flex items-center gap-3 transform translate-x-full 
                     transition-transform duration-300 border-l-4`;
  toast.innerHTML = `
    <div class="w-5 h-5 bg-white/20 rounded-full flex items-center justify-center text-sm font-bold">
      ${icons[type] || icons.info}
    </div>
    <span class="font-medium">${message}</span>
  `;

  document.body.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.style.transform = "translateX(0)";
  }, 10);

  // Remove after duration
  setTimeout(() => {
    toast.style.transform = "translateX(400px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return "Unknown";

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) {
      return `${diffInSeconds}s ago`;
    } else if (diffInSeconds < 3600) {
      return `${Math.floor(diffInSeconds / 60)}m ago`;
    } else if (diffInSeconds < 86400) {
      return `${Math.floor(diffInSeconds / 3600)}h ago`;
    } else if (diffInSeconds < 2592000) {
      return `${Math.floor(diffInSeconds / 86400)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  } catch (error) {
    return "Unknown";
  }
}

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

// Handle Save/Update Class
async function handleSaveClass(saveBtn) {
  const editId = saveBtn.getAttribute("data-edit-id");
  const isEdit = !!editId;

  // Match IDs from showAddClassModal
  const dayOfWeek = document.getElementById("daySelect").value.trim();
  const startTime = document.getElementById("timeSelect").value.trim(); // single time field
  const subject = document.getElementById("subjectInput").value.trim();
  const room = document.getElementById("roomInput").value.trim();
  const instructor = document.getElementById("teacherInput").value.trim();
  const color = document.getElementById("colorSelect").value.trim();

  // Validation
  if (!dayOfWeek || !startTime || !subject || !instructor) {
    showToast("Please fill in all required fields", "error");
    return;
  }

  const classData = {
    dayOfWeek,
    startTime,
    subject,
    room: room || "TBA",
    teacher,
    color,
    updatedAt: serverTimestamp(),
  };

  try {
    if (isEdit) {
      await updateDoc(doc(db, "timetable", editId), classData);
      showToast("Class updated successfully!", "success");
    } else {
      classData.createdAt = serverTimestamp();
      await addDoc(collection(db, "timetable"), classData);
      showToast("Class added successfully!", "success");
    }

    const modal = document.getElementById("addClassModal");
    if (modal) {
      modal.classList.add("hidden");
      const form = document.getElementById("addClassForm");
      if (form) form.reset();
      saveBtn.textContent = "Save Class";
      saveBtn.removeAttribute("data-edit-id");
    }

    loadTimetable();
  } catch (error) {
    console.error("Error saving class:", error);
    showToast("Error saving class: " + error.message, "error");
  }
}

// Initialize Dashboard
document.addEventListener("DOMContentLoaded", () => {
  console.log("🚀 Enhanced Dashboard initializing...");

  onAuthStateChanged(auth, async (user) => {
    if (user) {
      console.log("👤 User signed in:", user.uid);
      currentUser = user;

      try {
        await updateUserUI();
        showDashboard();

        // Setup presence and load chat after user is initialized
        try {
          setupPresence();
          loadOnlineUsers();
          loadChatMessages();
        } catch (e) {
          console.warn("post-login init failed:", e);
        }
      } catch (error) {
        console.error("❌ Error initializing dashboard:", error);
        showToast("Error loading dashboard", "error");
      }
    } else {
      console.warn("🚪 No user signed in. Redirecting...");
      window.location.href = "index.html";
    }
  });

  // Event Listeners

  // Profile form
  const profileForm = document.getElementById("profileForm");
  if (profileForm) {
    profileForm.addEventListener("submit", handleProfileSubmit);
  }

  // Message input
  const messageInput = document.getElementById("messageInput");
  if (messageInput) {
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        sendMessage();
      }
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener("click", (e) => {
    const userBtn = document.getElementById("userBtn");
    const userDropdown = document.getElementById("userDropdown");

    if (userBtn && userDropdown && !userBtn.contains(e.target)) {
      userDropdown.classList.add("hidden");
    }
  });

  // Add Class Modal Event Listeners
  document.addEventListener("click", (e) => {
    // Cancel button closes modal
    if (e.target.id === "cancelAddClass") {
      const modal = document.getElementById("addClassModal");
      if (modal) {
        modal.classList.add("hidden");
        // Reset form and button
        document.getElementById("addClassForm").reset();
        const saveBtn = document.getElementById("saveClassBtn");
        saveBtn.textContent = "Save Class";
        saveBtn.removeAttribute("data-edit-id");
      }
    }

    // Save button logic
    if (e.target.id === "saveClassBtn") {
      handleSaveClass(e.target);
    }
  });

  // Setup event listeners for file search and filters after modal opens
  document.addEventListener("click", (e) => {
    if (e.target.closest('[onclick="showFiles()"]')) {
      setTimeout(() => {
        setupFilesEventListeners();
      }, 500);
    }
  });
});

// Export functions to global scope for onclick handlers
window.showDashboard = showDashboard;
window.showProfile = showProfile;
window.showFiles = showFiles;
window.showUploadModal = showUploadModal;
window.showChat = showChat;
window.showTimetable = showTimetable;
window.showPolls = showPolls;
window.showEvents = showEvents;
window.showModal = showModal;
window.closeModal = closeModal;
window.toggleUserDropdown = toggleUserDropdown;
window.downloadFile = downloadFile;
window.previewFile = previewFile;
window.deleteFile = deleteFile;
window.clearFile = clearFile;
window.clearFilters = clearFilters;
window.sendMessage = sendMessage;
window.changePassword = changePassword;
window.handleLogout = handleLogout;
window.votePoll = votePoll;
window.joinEvent = joinEvent;
window.leaveEvent = leaveEvent;
window.closeTimetableModal = closeTimetableModal;
window.closePollsModal = closePollsModal;
window.closeEventsModal = closeEventsModal;
window.createTimetableEntry = createTimetableEntry;
window.editTimetableEntry = editTimetableEntry;
window.deleteTimetableEntry = deleteTimetableEntry;
//window.createPoll = createPoll;
window.deletePoll = deletePoll;
window.createEvent = createEvent;
window.deleteEvent = deleteEvent;

// Navigation for Files (Notes & Files)
document.getElementById("filesNav")?.addEventListener("click", (e) => {
  e.preventDefault();
  showFiles();
});

async function getImageKitAuth() {
  const res = await fetch("http://localhost:3000/api/imagekit/auth");
  return res.json();
}

document.addEventListener("DOMContentLoaded", () => {
  const saveBtn = document.getElementById("saveChangesBtn");
  if (!saveBtn) return;

  saveBtn.addEventListener("click", async (e) => {
    e.preventDefault(); // prevent form submission if inside a form

    const currentUser = auth.currentUser;
    if (!currentUser) {
      console.error("❌ No logged-in user found.");
      return;
    }

    // Gather updated profile data
    const updatedData = {
      displayName: document.getElementById("editFullName").value,
      phone: document.getElementById("editPhone").value,
      college: document.getElementById("editCollege").value,
      course: document.getElementById("editCourse").value,
      section: document.getElementById("editSection").value,
    };

    try {
      await updateDoc(doc(db, "users", currentUser.uid), updatedData);
      console.log("✅ Profile updated successfully");

      // Reload profile & dropdowns
      await loadProfileData(currentUser);
      await updateUserUI();
    } catch (err) {
      console.error("❌ Error saving profile data:", err);
    }
  });
});

// ===== Populate Courses Dropdown =====
async function populateCoursesDropdown(
  selectedCourse = "",
  selectedSection = ""
) {
  const courseSelect = document.getElementById("editCourse");
  const sectionSelect = document.getElementById("editSection");

  if (!courseSelect || !sectionSelect) {
    console.error("❌ Dropdown elements not found in HTML.");
    return;
  }

  courseSelect.innerHTML = '<option value="">Select Course</option>';
  sectionSelect.innerHTML = '<option value="">Select Section</option>';

  try {
    const coursesSnap = await getDocs(collection(db, "courses"));
    coursesSnap.forEach((docSnap) => {
      const courseName = docSnap.data().name;
      const opt = document.createElement("option");
      opt.value = docSnap.id; // Store ID instead of name
      opt.textContent = courseName;
      if (selectedCourse && selectedCourse === docSnap.id) opt.selected = true;
      courseSelect.appendChild(opt);
    });

    // Load sections if a course is preselected
    if (selectedCourse) {
      await populateSectionsDropdown(selectedCourse, selectedSection);
    }

    // On change, load sections
    courseSelect.addEventListener("change", (e) => {
      populateSectionsDropdown(e.target.value);
    });
  } catch (err) {
    console.error("❌ Error loading courses:", err);
  }
}

// ===== Populate Sections Dropdown =====
async function populateSectionsDropdown(selectedCourseId = null) {
  const sectionSelect = document.getElementById("editSection");
  if (!sectionSelect) {
    console.warn("❌ Section dropdown not found in DOM");
    return;
  }

  sectionSelect.innerHTML = `<option value="">Select Section</option>`;

  if (!selectedCourseId) {
    console.warn("⚠ No course selected, cannot load sections.");
    return;
  }

  try {
    let queryRef = collection(db, "sections");
    if (selectedCourseId) {
      queryRef = query(queryRef, where("courseId", "==", selectedCourseId));
    }

    const snapshot = await getDocs(queryRef);
    if (snapshot.empty) {
      console.warn("⚠ No sections found in Firestore");
      return;
    }

    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const option = document.createElement("option");
      option.value = docSnap.id;
      option.textContent = data.name || "Unnamed Section";
      sectionSelect.appendChild(option);
    });
  } catch (error) {
    console.error("❌ Error loading sections:", error);
  }
}

// ===== Load Profile Data =====
async function loadProfileData(user = auth.currentUser) {
  if (!user || !user.uid) {
    console.error("❌ No valid user provided to loadProfileData");
    return;
  }

  try {
    const docSnap = await getDoc(doc(db, "users", user.uid));
    if (!docSnap.exists()) {
      console.error("❌ User document not found");
      return;
    }

    const userData = docSnap.data();
    console.log("📄 User data:", userData); // Debug log

    // Use displayName for name
    const name =
      userData.displayName ||
      userData.fullName ||
      user.displayName || // Firebase Auth fallback
      "Not provided";

    const email = userData.email || user.email || "Not provided";
    const role = userData.role || "Not provided";
    const phone =
      userData.phone && userData.phone.trim() !== ""
        ? userData.phone
        : user.phoneNumber || "Not provided";
    const college =
      userData.college && userData.college.trim() !== ""
        ? userData.college
        : "Not provided";
    const course = userData.course || "Not provided";
    const section = userData.section || "Not provided";

    // Helper to safely update DOM
    const updateElement = (id, value) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent =
          value === "" || value === null || value === undefined
            ? "Not provided"
            : value;
      } else {
        console.warn(`⚠️ Element with ID '${id}' not found`);
      }
    };

    // Display info
    updateElement("profileName", name);
    updateElement("profileEmail", email);
    updateElement("profileRoleBadge", role);
    updateElement("profileFullName", name);
    updateElement("profileEmailField", email);
    updateElement("profileRoleField", role);
    updateElement("profilePhone", phone);
    updateElement("profileCollege", college);
    updateElement("profileCourse", course);
    updateElement("profileSection", section);

    console.log("✅ Profile data loaded successfully for:", role);
  } catch (err) {
    console.error("❌ Error loading profile data:", err);

    const updateElement = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };

    updateElement("profileName", "Error loading data");
    updateElement("profileFullName", "Not provided");
    updateElement("profilePhone", "Not provided");
    updateElement("profileCollege", "Not provided");
    updateElement("profileCourse", "Not provided");
    updateElement("profileSection", "Not provided");
  }
}

// ===== Auth Listener =====
onAuthStateChanged(auth, async (user) => {
  if (user) {
    console.log("✅ Logged in as:", user.uid);
    await loadProfileData(user);
  } else {
    console.warn("❌ No user logged in. Redirecting...");
    window.location.href = "/login.html";
  }
});

// === Avatar Upload Handling ===
// Handle avatar upload via ImageKit
document.getElementById("profileAvatarLarge").addEventListener("click", () => {
  document.getElementById("avatarUploadInput").click();
});

document
  .getElementById("avatarUploadInput")
  .addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", "YOUR_IMAGEKIT_UPLOAD_PRESET");

      const res = await fetch("YOUR_IMAGEKIT_UPLOAD_URL", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (data && data.url) {
        await updateDoc(doc(db, "users", auth.currentUser.uid), {
          avatar: data.url,
        });
        // Refresh profile
        loadProfileData();
      }
    } catch (err) {
      console.error("Error uploading avatar:", err);
    }
  });

// Edit & Save button logic
document.getElementById("editProfileBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.add("hidden");
  document.getElementById("profileEditSection").classList.remove("hidden");
  document.getElementById("editProfileBtn").classList.add("hidden");
  document.getElementById("saveProfileBtn").classList.remove("hidden");
  document.getElementById("cancelEditBtn").classList.remove("hidden");
});

document.getElementById("cancelEditBtn").addEventListener("click", () => {
  document.getElementById("profileViewSection").classList.remove("hidden");
  document.getElementById("profileEditSection").classList.add("hidden");
  document.getElementById("editProfileBtn").classList.remove("hidden");
  document.getElementById("saveProfileBtn").classList.add("hidden");
  document.getElementById("cancelEditBtn").classList.add("hidden");
});

document
  .getElementById("saveProfileBtn")
  .addEventListener("click", async () => {
    const updatedData = {
      fullName: document.getElementById("editFullName").value,
      phone: document.getElementById("editPhone").value,
      college: document.getElementById("editCollege").value,
      course: document.getElementById("editCourse").value,
      section: document.getElementById("editSection").value,
    };
    await updateDoc(doc(db, "users", auth.currentUser.uid), updatedData);
    await loadProfileData();
    document.getElementById("profileViewSection").classList.remove("hidden");
    document.getElementById("profileEditSection").classList.add("hidden");
    document.getElementById("editProfileBtn").classList.remove("hidden");
    document.getElementById("saveProfileBtn").classList.add("hidden");
    document.getElementById("cancelEditBtn").classList.add("hidden");
  });

// ======================= GRADE MANAGEMENT SYSTEM ======================= //

// Sample data initialization
const initializeSampleData = async () => {
  // Sample grades data
  const sampleGrades = [
    {
      studentName: "Alice Johnson",
      studentId: "ST001",
      course: "Mathematics",
      section: "A",
      grade: "A",
      marks: 95,
      maxMarks: 100,
      submissionDate: new Date(),
      faculty: "Dr. Smith",
    },
    {
      studentName: "Bob Wilson",
      studentId: "ST002",
      course: "Physics",
      section: "B",
      grade: "B+",
      marks: 87,
      maxMarks: 100,
      submissionDate: new Date(),
      faculty: "Prof. Brown",
    },
    {
      studentName: "Carol Davis",
      studentId: "ST003",
      course: "Chemistry",
      section: "A",
      grade: "A-",
      marks: 92,
      maxMarks: 100,
      submissionDate: new Date(),
      faculty: "Dr. Johnson",
    },
    {
      studentName: "David Miller",
      studentId: "ST004",
      course: "Mathematics",
      section: "B",
      grade: "B",
      marks: 84,
      maxMarks: 100,
      submissionDate: new Date(),
      faculty: "Dr. Smith",
    },
    {
      studentName: "Eva Garcia",
      studentId: "ST005",
      course: "Biology",
      section: "A",
      grade: "A+",
      marks: 98,
      maxMarks: 100,
      submissionDate: new Date(),
      faculty: "Prof. Lee",
    },
  ];

  // Sample attendance data
  const sampleAttendance = [
    {
      studentName: "Alice Johnson",
      studentId: "ST001",
      course: "Mathematics",
      section: "A",
      presentDays: 28,
      absentDays: 2,
      totalClasses: 30,
      lastAttendance: new Date(),
    },
    {
      studentName: "Bob Wilson",
      studentId: "ST002",
      course: "Physics",
      section: "B",
      presentDays: 25,
      absentDays: 5,
      totalClasses: 30,
      lastAttendance: new Date(),
    },
    {
      studentName: "Carol Davis",
      studentId: "ST003",
      course: "Chemistry",
      section: "A",
      presentDays: 29,
      absentDays: 1,
      totalClasses: 30,
      lastAttendance: new Date(),
    },
    {
      studentName: "David Miller",
      studentId: "ST004",
      course: "Mathematics",
      section: "B",
      presentDays: 26,
      absentDays: 4,
      totalClasses: 30,
      lastAttendance: new Date(),
    },
    {
      studentName: "Eva Garcia",
      studentId: "ST005",
      course: "Biology",
      section: "A",
      presentDays: 30,
      absentDays: 0,
      totalClasses: 30,
      lastAttendance: new Date(),
    },
  ];

  // Initialize if no data exists (only run once)
  try {
    // Check if localStorage has data (simulating Firestore)
    if (!localStorage.getItem("grades")) {
      localStorage.setItem(
        "grades",
        JSON.stringify(sampleGrades.map((g, i) => ({ id: "grade_" + i, ...g })))
      );
    }

    if (!localStorage.getItem("attendance")) {
      localStorage.setItem(
        "attendance",
        JSON.stringify(
          sampleAttendance.map((a, i) => ({ id: "att_" + i, ...a }))
        )
      );
    }
  } catch (error) {
    console.log("Sample data already exists or error:", error);
  }
};

// Simulate Firestore functions with localStorage
const mockFirestore = {
  collection: (name) => ({
    add: (data) => {
      const items = JSON.parse(localStorage.getItem(name) || "[]");
      const newItem = { id: name + "_" + Date.now(), ...data };
      items.push(newItem);
      localStorage.setItem(name, JSON.stringify(items));
      return Promise.resolve({ id: newItem.id });
    },
    get: () => {
      const items = JSON.parse(localStorage.getItem(name) || "[]");
      return Promise.resolve(items);
    },
    update: (id, data) => {
      const items = JSON.parse(localStorage.getItem(name) || "[]");
      const index = items.findIndex((item) => item.id === id);
      if (index !== -1) {
        items[index] = { ...items[index], ...data };
        localStorage.setItem(name, JSON.stringify(items));
      }
      return Promise.resolve();
    },
    delete: (id) => {
      const items = JSON.parse(localStorage.getItem(name) || "[]");
      const filteredItems = items.filter((item) => item.id !== id);
      localStorage.setItem(name, JSON.stringify(filteredItems));
      return Promise.resolve();
    },
  }),
};

function showGrades() {
  // Remove any existing modal
  document.getElementById("gradesModal")?.remove();

  // Modal HTML with enhanced features
  const modal = document.createElement("div");
  modal.id = "gradesModal";
  modal.className =
    "fixed inset-0 z-[10000] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="closeModal('gradesModal')"></div>
    <div class="relative bg-white rounded-3xl shadow-2xl w-full max-w-7xl mx-4 p-0 overflow-hidden max-h-[95vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-8 py-6 bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-700 rounded-t-3xl">
        <div class="flex gap-3 items-center">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">🎓</div>
          <div>
            <h2 class="text-3xl font-bold text-white">Grade Management System</h2>
            <p class="text-white/80 text-sm">Comprehensive grade tracking and analytics</p>
          </div>
        </div>
        <button onclick="closeModal('gradesModal')" class="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center text-white text-xl transition-all">✕</button>
      </div>

      <!-- Tab Navigation -->
      <div class="px-8 pt-6">
        <div class="flex gap-2 border-b border-gray-200">
          <button class="grade-tab px-6 py-3 font-semibold rounded-t-lg bg-blue-500 text-white" data-tab="overview">📊 Overview</button>
          <button class="grade-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-blue-500" data-tab="manage">📝 Manage Grades</button>
          <button class="grade-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-blue-500" data-tab="analytics">📈 Analytics</button>
          <button class="grade-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-blue-500" data-tab="reports">📄 Reports</button>
        </div>
      </div>

      <!-- Modal Body with Tabs -->
      <div class="px-8 pb-8 overflow-y-auto max-h-[70vh]">
        <!-- Overview Tab -->
        <div id="grades-overview" class="grade-tab-content">
          <div class="py-6">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div class="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-blue-600 text-sm font-medium">Total Students</p>
                    <p class="text-3xl font-bold text-blue-700" id="totalStudentsGrade">0</p>
                  </div>
                  <div class="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white text-xl">👥</div>
                </div>
              </div>
              <div class="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-green-600 text-sm font-medium">Average Grade</p>
                    <p class="text-3xl font-bold text-green-700" id="averageGrade">0</p>
                  </div>
                  <div class="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white text-xl">📊</div>
                </div>
              </div>
              <div class="bg-gradient-to-br from-yellow-50 to-yellow-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-yellow-600 text-sm font-medium">Pass Rate</p>
                    <p class="text-3xl font-bold text-yellow-700" id="passRate">0%</p>
                  </div>
                  <div class="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-white text-xl">✅</div>
                </div>
              </div>
              <div class="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-purple-600 text-sm font-medium">Top Performers</p>
                    <p class="text-3xl font-bold text-purple-700" id="topPerformers">0</p>
                  </div>
                  <div class="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center text-white text-xl">🏆</div>
                </div>
              </div>
            </div>
            <div class="bg-white rounded-xl shadow-lg p-6">
              <canvas id="gradeDistributionChart" width="400" height="200"></canvas>
            </div>
          </div>
        </div>

        <!-- Manage Grades Tab -->
        <div id="grades-manage" class="grade-tab-content hidden">
          <div class="py-6">
            <!-- Controls -->
            <div class="flex flex-wrap gap-4 mb-6 items-center">
              <input id="gradesSearch" type="text" placeholder="🔍 Search student, course, section..." class="px-4 py-3 border-2 border-gray-200 rounded-xl flex-1 min-w-[250px] focus:border-blue-500 focus:outline-none" />
              <select id="gradesCourseFilter" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                <option value="">All Courses</option>
              </select>
              <select id="courseFilter" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                <option value="">All Sections</option>
                <option value="electronics">Electronics</option>
                <option value="mechanical">Mechanical</option>
                <option value="civil">Civil</option>
                <option value="computer-science">Computer Science</option>
                <option value="information-technology">Information Technology</option>
                <option value="artifical-intelligence & machine-learning">Artifical-Intelligence & Machine-Learning</option>
              </select>
              <button onclick="showAddGradeForm()" class="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all flex items-center gap-2">
                <span>➕</span> Add Grade
              </button>
            </div>

            <!-- Grades Table -->
            <div id="gradesList" class="bg-white rounded-xl shadow-lg overflow-hidden">
              <div class="text-center py-12">
                <div class="text-6xl mb-4 animate-pulse">🎓</div>
                <p class="text-gray-500">Loading grades...</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Analytics Tab -->
        <div id="grades-analytics" class="grade-tab-content hidden">
          <div class="py-6">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">Grade Trends</h3>
                <canvas id="gradeTrendsChart" width="400" height="300"></canvas>
              </div>
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">Course Performance</h3>
                <canvas id="coursePerformanceChart" width="400" height="300"></canvas>
              </div>
            </div>
            <div class="mt-6 bg-white rounded-xl shadow-lg p-6">
              <h3 class="text-xl font-bold mb-4 text-gray-700">Detailed Analytics</h3>
              <div id="detailedAnalytics" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Analytics content will be populated here -->
              </div>
            </div>
          </div>
        </div>

        <!-- Reports Tab -->
        <div id="grades-reports" class="grade-tab-content hidden">
          <div class="py-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">📊 Generate Reports</h3>
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
                    <select id="reportType" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl">
                      <option value="individual">Individual Student Report</option>
                      <option value="course">Course Report</option>
                      <option value="section">Section Report</option>
                      <option value="comprehensive">Comprehensive Report</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Select Student/Course</label>
                    <select id="reportSubject" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl">
                      <option value="">Select...</option>
                    </select>
                  </div>
                  <button onclick="generateGradePDF()" class="w-full px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📄</span> Generate PDF Report
                  </button>
                </div>
              </div>
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">📈 Export Options</h3>
                <div class="space-y-4">
                  <button onclick="exportGradesCSV()" class="w-full px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📊</span> Export to CSV
                  </button>
                  <button onclick="exportGradesExcel()" class="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📋</span> Export to Excel
                  </button>
                  <button onclick="printGradeReport()" class="w-full px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>🖨️</span> Print Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Initialize sample data
  initializeSampleData();

  // Tab switching functionality
  const tabButtons = modal.querySelectorAll(".grade-tab");
  const tabContents = modal.querySelectorAll(".grade-tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.getAttribute("data-tab");

      // Update active tab button
      tabButtons.forEach((btn) => {
        btn.classList.remove("bg-blue-500", "text-white");
        btn.classList.add("text-gray-600", "hover:text-blue-500");
      });
      button.classList.add("bg-blue-500", "text-white");
      button.classList.remove("text-gray-600", "hover:text-blue-500");

      // Show corresponding tab content
      tabContents.forEach((content) => content.classList.add("hidden"));
      document.getElementById(`grades-${tabName}`).classList.remove("hidden");

      // Load specific tab content
      if (tabName === "overview") loadGradeOverview();
      if (tabName === "analytics") loadGradeAnalytics();
    });
  });

  // Load initial tab
  loadGradeOverview();
  setupGradeManagement();
}

function loadGradeOverview() {
  // Load overview statistics and charts
  mockFirestore
    .collection("grades")
    .get()
    .then((grades) => {
      // Update statistics
      document.getElementById("totalStudentsGrade").textContent = grades.length;

      const totalMarks = grades.reduce(
        (sum, grade) => sum + (grade.marks || 0),
        0
      );
      const avgGrade = grades.length
        ? (totalMarks / grades.length).toFixed(1)
        : 0;
      document.getElementById("averageGrade").textContent = avgGrade + "%";

      const passCount = grades.filter(
        (grade) => (grade.marks || 0) >= 60
      ).length;
      const passRate = grades.length
        ? ((passCount / grades.length) * 100).toFixed(1)
        : 0;
      document.getElementById("passRate").textContent = passRate + "%";

      const topPerformers = grades.filter(
        (grade) => (grade.marks || 0) >= 90
      ).length;
      document.getElementById("topPerformers").textContent = topPerformers;

      // Create grade distribution chart if Chart.js is available
      if (typeof Chart !== "undefined") {
        createGradeDistributionChart(grades);
      }
    });
}

function createGradeDistributionChart(grades) {
  const ctx = document
    .getElementById("gradeDistributionChart")
    ?.getContext("2d");
  if (!ctx) return;

  // Clear existing chart
  if (
    window.gradeTrendsChart &&
    typeof window.gradeTrendsChart.destroy === "function"
  ) {
    window.gradeTrendsChart.destroy();
  }

  const gradeRanges = {
    "A+ (90-100)": grades.filter((g) => g.marks >= 90).length,
    "A (80-89)": grades.filter((g) => g.marks >= 80 && g.marks < 90).length,
    "B (70-79)": grades.filter((g) => g.marks >= 70 && g.marks < 80).length,
    "C (60-69)": grades.filter((g) => g.marks >= 60 && g.marks < 70).length,
    "F (0-59)": grades.filter((g) => g.marks < 60).length,
  };

  window.gradeChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: Object.keys(gradeRanges),
      datasets: [
        {
          label: "Number of Students",
          data: Object.values(gradeRanges),
          backgroundColor: [
            "#10B981",
            "#3B82F6",
            "#F59E0B",
            "#EF4444",
            "#6B7280",
          ],
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Grade Distribution",
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            stepSize: 1,
          },
        },
      },
    },
  });
}

function setupGradeManagement() {
  // Load and render grades
  function renderGrades(data) {
    if (!data.length) {
      document.getElementById("gradesList").innerHTML = `
        <div class="text-center py-12">
          <div class="text-6xl mb-4">📄</div>
          <p class="text-gray-500 text-lg">No grades found</p>
          <button onclick="showAddGradeForm()" class="mt-4 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold">
            Add First Grade
          </button>
        </div>
      `;
      return;
    }

    document.getElementById("gradesList").innerHTML = `
      <table class="min-w-full">
        <thead>
          <tr class="bg-gradient-to-r from-indigo-50 to-purple-50">
            <th class="p-4 text-left font-bold text-gray-700">Student Info</th>
            <th class="p-4 text-left font-bold text-gray-700">Course Details</th>
            <th class="p-4 text-left font-bold text-gray-700">Grade & Marks</th>
            <th class="p-4 text-left font-bold text-gray-700">Faculty</th>
            <th class="p-4 text-left font-bold text-gray-700">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data
            .map(
              (g) => `
            <tr class="hover:bg-indigo-50/50 transition-all border-b border-gray-100">
              <td class="p-4">
                <div class="flex items-center gap-3">
                  <div class="w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center text-white font-bold">
                    ${g.studentName.charAt(0)}
                  </div>
                  <div>
                    <div class="font-semibold text-gray-900">${
                      g.studentName
                    }</div>
                    <div class="text-sm text-gray-500">ID: ${
                      g.studentId || "N/A"
                    }</div>
                  </div>
                </div>
              </td>
              <td class="p-4">
                <div class="font-medium text-gray-900">${g.course}</div>
                <div class="text-sm text-gray-500">Section: ${g.section}</div>
              </td>
              <td class="p-4">
                <div class="flex items-center gap-3">
                  <div class="px-3 py-2 bg-blue-100 rounded-lg font-bold text-blue-700 text-lg">${
                    g.grade
                  }</div>
                  <div class="text-right">
                    <div class="font-bold text-lg">${g.marks || 0}</div>
                    <div class="text-xs text-gray-500">/${
                      g.maxMarks || 100
                    }</div>
                  </div>
                </div>
              </td>
              <td class="p-4">
                <div class="text-sm font-medium text-gray-700">${
                  g.faculty || "Not Assigned"
                }</div>
              </td>
              <td class="p-4">
                <div class="flex gap-2">
                  <button onclick="editGrade('${
                    g.id
                  }')" class="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg text-sm font-medium transition-all">
                    ✏️ Edit
                  </button>
                  <button onclick="deleteGrade('${
                    g.id
                  }')" class="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-medium transition-all">
                    🗑️ Delete
                  </button>
                </div>
              </td>
            </tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    `;
  }

  // Load grades and setup filters
  mockFirestore
    .collection("grades")
    .get()
    .then((grades) => {
      renderGrades(grades);
      populateGradeFilters(grades);
    });

  // Search functionality
  document.getElementById("gradesSearch").addEventListener("input", (e) => {
    const search = e.target.value.toLowerCase();
    mockFirestore
      .collection("grades")
      .get()
      .then((grades) => {
        const filtered = grades.filter(
          (g) =>
            g.studentName.toLowerCase().includes(search) ||
            g.course.toLowerCase().includes(search) ||
            g.section.toLowerCase().includes(search) ||
            (g.studentId && g.studentId.toLowerCase().includes(search))
        );
        renderGrades(filtered);
      });
  });
}

// Grade CRUD Functions
window.deleteGrade = async function (id) {
  if (
    !confirm(
      "Are you sure you want to delete this grade? This action cannot be undone."
    )
  )
    return;

  try {
    await mockFirestore.collection("grades").delete(id);
    showToast("Grade deleted successfully!", "success");
    // Refresh the display
    setupGradeManagement();
    loadGradeOverview();
  } catch (error) {
    showToast("Error deleting grade: " + error.message, "error");
  }
};

window.editGrade = function (id) {
  showEditGradeForm(id);
};

window.showAddGradeForm = function () {
  const formModal = document.createElement("div");
  formModal.id = "addGradeModal";
  formModal.className =
    "fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
  formModal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-2xl font-bold text-gray-800">➕ Add New Grade</h3>
        <button onclick="closeAddGradeForm()" class="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-300">✕</button>
      </div>
      <form id="addGradeForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Student Name</label>
          <input type="text" id="studentName" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Student ID</label>
          <input type="text" id="studentId" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Course</label>
            <input type="text" id="course" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Section</label>
            <input type="text" id="section" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Grade</label>
            <select id="grade" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
              <option value="">Select Grade</option>
              <option value="A+">A+ (90-100)</option>
              <option value="A">A (80-89)</option>
              <option value="A-">A- (75-79)</option>
              <option value="B+">B+ (70-74)</option>
              <option value="B">B (65-69)</option>
              <option value="B-">B- (60-64)</option>
              <option value="C+">C+ (55-59)</option>
              <option value="C">C (50-54)</option>
              <option value="D">D (40-49)</option>
              <option value="F">F (0-39)</option>
            </select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Marks</label>
            <input type="number" id="marks" required min="0" max="100" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
          </div>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Faculty</label>
          <input type="text" id="faculty" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
        </div>
        <div class="flex gap-4 pt-4">
          <button type="submit" class="flex-1 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-all">
            Add Grade
          </button>
          <button type="button" onclick="closeAddGradeForm()" class="flex-1 px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-xl font-semibold transition-all">
            Cancel
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(formModal);

  document
    .getElementById("addGradeForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const gradeData = {
        studentName: document.getElementById("studentName").value,
        studentId: document.getElementById("studentId").value,
        course: document.getElementById("course").value,
        section: document.getElementById("section").value,
        grade: document.getElementById("grade").value,
        marks: parseInt(document.getElementById("marks").value),
        maxMarks: 100,
        faculty: document.getElementById("faculty").value,
        submissionDate: new Date(),
        createdAt: new Date(),
      };

      try {
        await mockFirestore.collection("grades").add(gradeData);
        showToast("Grade added successfully!", "success");
        closeAddGradeForm();
        setupGradeManagement();
        loadGradeOverview();
      } catch (error) {
        showToast("Error adding grade: " + error.message, "error");
      }
    });
};

window.closeAddGradeForm = function () {
  document.getElementById("addGradeModal")?.remove();
};

function showEditGradeForm(gradeId) {
  // Get current grade data
  mockFirestore
    .collection("grades")
    .get()
    .then((grades) => {
      const gradeData = grades.find((g) => g.id === gradeId);
      if (!gradeData) return;

      const formModal = document.createElement("div");
      formModal.id = "editGradeModal";
      formModal.className =
        "fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
      formModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-2xl font-bold text-gray-800">✏️ Edit Grade</h3>
          <button onclick="closeEditGradeForm()" class="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-300">✕</button>
        </div>
        <form id="editGradeForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Student Name</label>
            <input type="text" id="editStudentName" value="${
              gradeData.studentName
            }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Student ID</label>
            <input type="text" id="editStudentId" value="${
              gradeData.studentId || ""
            }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Course</label>
              <input type="text" id="editCourse" value="${
                gradeData.course
              }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Section</label>
              <input type="text" id="editSection" value="${
                gradeData.section
              }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Grade</label>
              <select id="editGrade" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
                <option value="A+" ${
                  gradeData.grade === "A+" ? "selected" : ""
                }>A+ (90-100)</option>
                <option value="A" ${
                  gradeData.grade === "A" ? "selected" : ""
                }>A (80-89)</option>
                <option value="A-" ${
                  gradeData.grade === "A-" ? "selected" : ""
                }>A- (75-79)</option>
                <option value="B+" ${
                  gradeData.grade === "B+" ? "selected" : ""
                }>B+ (70-74)</option>
                <option value="B" ${
                  gradeData.grade === "B" ? "selected" : ""
                }>B (65-69)</option>
                <option value="B-" ${
                  gradeData.grade === "B-" ? "selected" : ""
                }>B- (60-64)</option>
                <option value="C+" ${
                  gradeData.grade === "C+" ? "selected" : ""
                }>C+ (55-59)</option>
                <option value="C" ${
                  gradeData.grade === "C" ? "selected" : ""
                }>C (50-54)</option>
                <option value="D" ${
                  gradeData.grade === "D" ? "selected" : ""
                }>D (40-49)</option>
                <option value="F" ${
                  gradeData.grade === "F" ? "selected" : ""
                }>F (0-39)</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Marks</label>
              <input type="number" id="editMarks" value="${
                gradeData.marks || 0
              }" required min="0" max="100" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
            </div>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Faculty</label>
            <input type="text" id="editFaculty" value="${
              gradeData.faculty || ""
            }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-blue-500 focus:outline-none">
          </div>
          <div class="flex gap-4 pt-4">
            <button type="submit" class="flex-1 px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-all">
              Update Grade
            </button>
            <button type="button" onclick="closeEditGradeForm()" class="flex-1 px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-xl font-semibold transition-all">
              Cancel
            </button>
          </div>
        </form>
      </div>
    `;
      document.body.appendChild(formModal);

      document
        .getElementById("editGradeForm")
        .addEventListener("submit", async (e) => {
          e.preventDefault();

          const updatedData = {
            studentName: document.getElementById("editStudentName").value,
            studentId: document.getElementById("editStudentId").value,
            course: document.getElementById("editCourse").value,
            section: document.getElementById("editSection").value,
            grade: document.getElementById("editGrade").value,
            marks: parseInt(document.getElementById("editMarks").value),
            faculty: document.getElementById("editFaculty").value,
            updatedAt: new Date(),
          };

          try {
            await mockFirestore
              .collection("grades")
              .update(gradeId, updatedData);
            showToast("Grade updated successfully!", "success");
            closeEditGradeForm();
            setupGradeManagement();
            loadGradeOverview();
          } catch (error) {
            showToast("Error updating grade: " + error.message, "error");
          }
        });
    });
}

window.closeEditGradeForm = function () {
  document.getElementById("editGradeModal")?.remove();
};

function populateGradeFilters(grades) {
  const courses = [...new Set(grades.map((g) => g.course))];
  const sections = [...new Set(grades.map((g) => g.section))];

  const courseFilter = document.getElementById("gradesCourseFilter");
  const sectionFilter = document.getElementById("gradesSectionFilter");

  if (courseFilter) {
    courseFilter.innerHTML = '<option value="">All Courses</option>';
    courses.forEach((course) => {
      const option = document.createElement("option");
      option.value = course;
      option.textContent = course;
      courseFilter.appendChild(option);
    });
  }

  if (sectionFilter) {
    sectionFilter.innerHTML = '<option value="">All Sections</option>';
    sections.forEach((section) => {
      const option = document.createElement("option");
      option.value = section;
      option.textContent = section;
      sectionFilter.appendChild(option);
    });
  }
}

function loadGradeAnalytics() {
  mockFirestore
    .collection("grades")
    .get()
    .then((grades) => {
      if (typeof Chart !== "undefined") {
        createGradeTrendsChart(grades);
        createCoursePerformanceChart(grades);
      }
      createDetailedAnalytics(grades);
    });
}

function createGradeTrendsChart(grades) {
  // Debug what we have
  if (window.gradeTrendsChart) {
    console.log("Existing chart:", window.gradeTrendsChart);
    console.log("Has destroy method:", typeof window.gradeTrendsChart.destroy);
  }

  // Safe destruction - handle multiple chart libraries
  if (window.gradeTrendsChart) {
    try {
      // Chart.js
      if (typeof window.gradeTrendsChart.destroy === "function") {
        window.gradeTrendsChart.destroy();
      }
      // Plotly
      else if (typeof window.gradeTrendsChart.purge === "function") {
        window.gradeTrendsChart.purge();
      }
      // Generic cleanup
      else {
        console.warn("Unknown chart type, clearing reference");
      }
    } catch (error) {
      console.warn("Error destroying chart:", error);
    }

    // Always clear the reference
    window.gradeTrendsChart = null;
  }

  // Get the canvas context
  const ctx = document.getElementById("gradeTrendsChart")?.getContext("2d");
  if (!ctx) {
    console.error('Canvas element "gradeTrendsChart" not found');
    return;
  }

  // Process grades data for trends (assuming grades have date/time info)
  if (!grades || grades.length === 0) {
    console.warn("No grades data available for trends chart");
    return;
  }

  // Sort grades by date if available, or use array index
  const sortedGrades = [...grades].sort((a, b) => {
    if (a.date && b.date) {
      return new Date(a.date) - new Date(b.date);
    }
    return 0;
  });

  // Create labels and data for the trend
  const labels = sortedGrades.map((grade, index) => {
    if (grade.date) {
      return new Date(grade.date).toLocaleDateString();
    }
    return `Grade ${index + 1}`;
  });

  const data = sortedGrades.map((grade) => grade.marks || 0);

  // Create the line chart
  window.gradeTrendsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Grade Trends",
          data: data,
          borderColor: "#3B82F6",
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Grade Trends Over Time",
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: {
            display: true,
            text: "Marks",
          },
        },
        x: {
          title: {
            display: true,
            text: "Time",
          },
        },
      },
    },
  });
}

function createCoursePerformanceChart(grades) {
  const ctx = document
    .getElementById("coursePerformanceChart")
    ?.getContext("2d");
  if (!ctx) return;

  // Apply the same safe destruction logic here
  if (window.coursePerformanceChart) {
    try {
      // Chart.js
      if (typeof window.coursePerformanceChart.destroy === "function") {
        window.coursePerformanceChart.destroy();
      }
      // Plotly
      else if (typeof window.coursePerformanceChart.purge === "function") {
        window.coursePerformanceChart.purge();
      }
      // Generic cleanup
      else {
        console.warn("Unknown chart type, clearing reference");
        // Clear canvas manually
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      }
    } catch (error) {
      console.warn("Error destroying chart:", error);
      // Clear canvas manually as fallback
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    // Always clear the reference
    window.coursePerformanceChart = null;
  }

  // Group by course
  const courseData = {};
  grades.forEach((grade) => {
    if (!courseData[grade.course]) courseData[grade.course] = [];
    courseData[grade.course].push(grade.marks || 0);
  });

  const courses = Object.keys(courseData);
  const avgMarks = courses.map((course) => {
    const marks = courseData[course];
    return marks.reduce((sum, mark) => sum + mark, 0) / marks.length;
  });

  window.coursePerformanceChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: courses,
      datasets: [
        {
          label: "Average Performance",
          data: avgMarks,
          backgroundColor: [
            "#3B82F6",
            "#10B981",
            "#F59E0B",
            "#EF4444",
            "#8B5CF6",
            "#EC4899",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Course Performance Distribution",
        },
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

function createDetailedAnalytics(grades) {
  const container = document.getElementById("detailedAnalytics");
  if (!container) return;

  // Calculate various analytics
  const totalStudents = grades.length;
  const avgMarks =
    grades.reduce((sum, g) => sum + (g.marks || 0), 0) / totalStudents;
  const highestMark = Math.max(...grades.map((g) => g.marks || 0));

  // Course with highest average
  const courseAvgs = {};
  grades.forEach((g) => {
    if (!courseAvgs[g.course]) courseAvgs[g.course] = [];
    courseAvgs[g.course].push(g.marks || 0);
  });

  let bestCourse = "";
  let bestAvg = 0;
  for (const course in courseAvgs) {
    const avg =
      courseAvgs[course].reduce((sum, mark) => sum + mark, 0) /
      courseAvgs[course].length;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestCourse = course;
    }
  }

  container.innerHTML = `
    <div class="bg-blue-50 p-4 rounded-xl text-center">
      <div class="text-2xl font-bold text-blue-600">${avgMarks.toFixed(1)}</div>
      <div class="text-sm text-blue-500">Overall Average</div>
    </div>
    <div class="bg-green-50 p-4 rounded-xl text-center">
      <div class="text-2xl font-bold text-green-600">${highestMark}</div>
      <div class="text-sm text-green-500">Highest Score</div>
    </div>
    <div class="bg-yellow-50 p-4 rounded-xl text-center">
      <div class="text-2xl font-bold text-yellow-600">${bestCourse}</div>
      <div class="text-sm text-yellow-500">Top Course (${bestAvg.toFixed(
        1
      )}%)</div>
    </div>
  `;
}

// Export Functions
window.exportGradesCSV = function () {
  mockFirestore
    .collection("grades")
    .get()
    .then((grades) => {
      let csv =
        "Student Name,Student ID,Course,Section,Grade,Marks,Max Marks,Faculty,Submission Date\n";
      grades.forEach((grade) => {
        csv += `"${grade.studentName}","${grade.studentId || ""}","${
          grade.course
        }","${grade.section}","${grade.grade}","${grade.marks || 0}","${
          grade.maxMarks || 100
        }","${grade.faculty || ""}","${
          grade.submissionDate
            ? new Date(grade.submissionDate).toLocaleDateString()
            : ""
        }"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `grades_export_${
        new Date().toISOString().split("T")[0]
      }.csv`;
      a.click();
      window.URL.revokeObjectURL(url);

      showToast("CSV exported successfully!", "success");
    });
};

window.exportGradesExcel = function () {
  exportGradesCSV();
  showToast("Excel export completed! (CSV format)", "success");
};

window.printGradeReport = function () {
  window.print();
};

window.generateGradePDF = function () {
  showToast("PDF generation feature requires jsPDF library", "info");
};

// ======================= ATTENDANCE SYSTEM ======================= //

function showAttendance() {
  document.getElementById("attendanceModal")?.remove();

  const modal = document.createElement("div");
  modal.id = "attendanceModal";
  modal.className =
    "fixed inset-0 z-[10000] flex items-center justify-center p-4";
  modal.innerHTML = `
    <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" onclick="closeModal('attendanceModal')"></div>
    <div class="relative bg-white rounded-3xl shadow-2xl w-full max-w-7xl mx-4 p-0 overflow-hidden max-h-[95vh]">
      <!-- Header -->
      <div class="flex items-center justify-between px-8 py-6 bg-gradient-to-r from-green-500 via-teal-500 to-blue-500 rounded-t-3xl">
        <div class="flex gap-3 items-center">
          <div class="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center text-3xl">✅</div>
          <div>
            <h2 class="text-3xl font-bold text-white">Attendance Management System</h2>
            <p class="text-white/80 text-sm">Real-time attendance tracking and analytics</p>
          </div>
        </div>
        <button onclick="closeModal('attendanceModal')" class="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center text-white text-xl transition-all">✕</button>
      </div>

      <!-- Tab Navigation -->
      <div class="px-8 pt-6">
        <div class="flex gap-2 border-b border-gray-200">
          <button class="attendance-tab px-6 py-3 font-semibold rounded-t-lg bg-green-500 text-white" data-tab="overview">📊 Overview</button>
          <button class="attendance-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-green-500" data-tab="mark">✅ Mark Attendance</button>
          <button class="attendance-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-green-500" data-tab="manage">👥 Manage Records</button>
          <button class="attendance-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-green-500" data-tab="analytics">📈 Analytics</button>
          <button class="attendance-tab px-6 py-3 font-semibold rounded-t-lg text-gray-600 hover:text-green-500" data-tab="reports">📄 Reports</button>
        </div>
      </div>

      <!-- Modal Body with Tabs -->
      <div class="px-8 pb-8 overflow-y-auto max-h-[70vh]">
        <!-- Overview Tab -->
        <div id="attendance-overview" class="attendance-tab-content">
          <div class="py-6">
            <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
              <div class="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-green-600 text-sm font-medium">Total Students</p>
                    <p class="text-3xl font-bold text-green-700" id="totalStudentsAtt">0</p>
                  </div>
                  <div class="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center text-white text-xl">👥</div>
                </div>
              </div>
              <div class="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-blue-600 text-sm font-medium">Overall Attendance</p>
                    <p class="text-3xl font-bold text-blue-700" id="overallAttendance">0%</p>
                  </div>
                  <div class="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center text-white text-xl">📊</div>
                </div>
              </div>
              <div class="bg-gradient-to-br from-yellow-50 to-yellow-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-yellow-600 text-sm font-medium">Present Today</p>
                    <p class="text-3xl font-bold text-yellow-700" id="presentToday">0</p>
                  </div>
                  <div class="w-12 h-12 bg-yellow-500 rounded-full flex items-center justify-center text-white text-xl">✅</div>
                </div>
              </div>
              <div class="bg-gradient-to-br from-red-50 to-red-100 p-6 rounded-xl">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-red-600 text-sm font-medium">Low Attendance</p>
                    <p class="text-3xl font-bold text-red-700" id="lowAttendance">0</p>
                  </div>
                  <div class="w-12 h-12 bg-red-500 rounded-full flex items-center justify-center text-white text-xl">⚠️</div>
                </div>
              </div>
            </div>
            <div class="bg-white rounded-xl shadow-lg p-6">
              <canvas id="attendanceOverviewChart" width="400" height="200"></canvas>
            </div>
          </div>
        </div>

        <!-- Mark Attendance Tab -->
        <div id="attendance-mark" class="attendance-tab-content hidden">
          <div class="py-6">
            <div class="flex flex-wrap gap-4 mb-6 items-center">
              <select id="markCourseSelect" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
                <option value="">Select Course</option>
              </select>
              <select id="markSectionSelect" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
                <option value="">Select Section</option>
              </select>
              <input type="date" id="attendanceDate" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none" value="${
                new Date().toISOString().split("T")[0]
              }">
              <button onclick="loadStudentsForAttendance()" class="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all">
                Load Students
              </button>
            </div>
            <div id="attendanceMarkingArea" class="bg-white rounded-xl shadow-lg p-6">
              <div class="text-center py-12 text-gray-500">
                <div class="text-6xl mb-4">👥</div>
                <p>Select course and section to mark attendance</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Manage Records Tab -->
        <div id="attendance-manage" class="attendance-tab-content hidden">
          <div class="py-6">
            <div class="flex flex-wrap gap-4 mb-6 items-center">
              <input id="attendanceSearch" type="text" placeholder="🔍 Search student, course, section..." class="px-4 py-3 border-2 border-gray-200 rounded-xl flex-1 min-w-[250px] focus:border-green-500 focus:outline-none" />
              <select id="attendanceCourseFilter" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
                <option value="">All Courses</option>
              </select>
              <select id="attendanceSectionFilter" class="px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
                <option value="">All Sections</option>
              </select>
              <button onclick="showAddAttendanceForm()" class="px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all flex items-center gap-2">
                <span>➕</span> Add Student
              </button>
            </div>
            <div id="attendanceList" class="bg-white rounded-xl shadow-lg overflow-hidden">
              <div class="text-center py-12">
                <div class="text-6xl mb-4 animate-pulse">✅</div>
                <p class="text-gray-500">Loading attendance records...</p>
              </div>
            </div>
          </div>
        </div>

        <!-- Analytics Tab -->
        <div id="attendance-analytics" class="attendance-tab-content hidden">
          <div class="py-6">
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">Attendance Trends</h3>
                <canvas id="attendanceTrendsChart" width="400" height="300"></canvas>
              </div>
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">Course-wise Attendance</h3>
                <canvas id="courseAttendanceChart" width="400" height="300"></canvas>
              </div>
            </div>
            <div class="mt-6 bg-white rounded-xl shadow-lg p-6">
              <h3 class="text-xl font-bold mb-4 text-gray-700">Detailed Analytics</h3>
              <div id="attendanceDetailedAnalytics" class="grid grid-cols-1 md:grid-cols-3 gap-4">
                <!-- Analytics content will be populated here -->
              </div>
            </div>
          </div>
        </div>

        <!-- Reports Tab -->
        <div id="attendance-reports" class="attendance-tab-content hidden">
          <div class="py-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">📊 Generate Reports</h3>
                <div class="space-y-4">
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Report Type</label>
                    <select id="attendanceReportType" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl">
                      <option value="individual">Individual Student Report</option>
                      <option value="course">Course Attendance Report</option>
                      <option value="section">Section Report</option>
                      <option value="monthly">Monthly Report</option>
                      <option value="comprehensive">Comprehensive Report</option>
                    </select>
                  </div>
                  <div>
                    <label class="block text-sm font-medium text-gray-700 mb-2">Select Subject</label>
                    <select id="attendanceReportSubject" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl">
                      <option value="">Select...</option>
                    </select>
                  </div>
                  <div class="grid grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">From Date</label>
                      <input type="date" id="attendanceFromDate" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl">
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 mb-2">To Date</label>
                      <input type="date" id="attendanceToDate" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl" value="${
                        new Date().toISOString().split("T")[0]
                      }">
                    </div>
                  </div>
                  <button onclick="generateAttendancePDF()" class="w-full px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📄</span> Generate PDF Report
                  </button>
                </div>
              </div>
              <div class="bg-white rounded-xl shadow-lg p-6">
                <h3 class="text-xl font-bold mb-4 text-gray-700">📈 Export Options</h3>
                <div class="space-y-4">
                  <button onclick="exportAttendanceCSV()" class="w-full px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📊</span> Export to CSV
                  </button>
                  <button onclick="exportAttendanceExcel()" class="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📋</span> Export to Excel
                  </button>
                  <button onclick="sendAttendanceReport()" class="w-full px-6 py-3 bg-purple-500 hover:bg-purple-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>📧</span> Email Report
                  </button>
                  <button onclick="printAttendanceReport()" class="w-full px-6 py-3 bg-gray-500 hover:bg-gray-600 text-white rounded-xl font-semibold transition-all flex items-center justify-center gap-2">
                    <span>🖨️</span> Print Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // Initialize sample data
  initializeSampleData();

  // Tab switching functionality
  const tabButtons = modal.querySelectorAll(".attendance-tab");
  const tabContents = modal.querySelectorAll(".attendance-tab-content");

  tabButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const tabName = button.getAttribute("data-tab");

      // Update active tab button
      tabButtons.forEach((btn) => {
        btn.classList.remove("bg-green-500", "text-white");
        btn.classList.add("text-gray-600", "hover:text-green-500");
      });
      button.classList.add("bg-green-500", "text-white");
      button.classList.remove("text-gray-600", "hover:text-green-500");

      // Show corresponding tab content
      tabContents.forEach((content) => content.classList.add("hidden"));
      document
        .getElementById(`attendance-${tabName}`)
        .classList.remove("hidden");

      // Load specific tab content
      if (tabName === "overview") loadAttendanceOverview();
      if (tabName === "analytics") loadAttendanceAnalytics();
      if (tabName === "mark") setupAttendanceMarking();
      if (tabName === "manage") setupAttendanceManagement();
    });
  });

  // Load initial tab
  loadAttendanceOverview();
}

function loadAttendanceOverview() {
  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      // Update statistics
      document.getElementById("totalStudentsAtt").textContent =
        attendance.length;

      // Calculate overall attendance percentage
      let totalPresent = 0,
        totalClasses = 0;
      attendance.forEach((record) => {
        totalPresent += record.presentDays || 0;
        totalClasses += record.totalClasses || 0;
      });

      const overallAttendance = totalClasses
        ? ((totalPresent / totalClasses) * 100).toFixed(1)
        : 0;
      document.getElementById("overallAttendance").textContent =
        overallAttendance + "%";

      // Mock data for "Present Today"
      const presentToday = Math.floor(attendance.length * 0.85);
      document.getElementById("presentToday").textContent = presentToday;

      // Students with low attendance (< 75%)
      const lowAttendanceCount = attendance.filter((record) => {
        const percentage = record.totalClasses
          ? ((record.presentDays || 0) / record.totalClasses) * 100
          : 0;
        return percentage < 75;
      }).length;
      document.getElementById("lowAttendance").textContent = lowAttendanceCount;

      if (typeof Chart !== "undefined") {
        createAttendanceOverviewChart(attendance);
      }
    });
}

function createAttendanceOverviewChart(attendance) {
  const ctx = document
    .getElementById("attendanceOverviewChart")
    ?.getContext("2d");
  if (!ctx) return;

  if (
    attendanceOverviewChart &&
    typeof attendanceOverviewChart.destroy === "function"
  ) {
    attendanceOverviewChart.destroy();
  }

  // Create attendance distribution
  const ranges = {
    "Excellent (90-100%)": attendance.filter((a) => {
      const perc = a.totalClasses
        ? ((a.presentDays || 0) / a.totalClasses) * 100
        : 0;
      return perc >= 90;
    }).length,
    "Good (80-89%)": attendance.filter((a) => {
      const perc = a.totalClasses
        ? ((a.presentDays || 0) / a.totalClasses) * 100
        : 0;
      return perc >= 80 && perc < 90;
    }).length,
    "Average (70-79%)": attendance.filter((a) => {
      const perc = a.totalClasses
        ? ((a.presentDays || 0) / a.totalClasses) * 100
        : 0;
      return perc >= 70 && perc < 80;
    }).length,
    "Below Average (60-69%)": attendance.filter((a) => {
      const perc = a.totalClasses
        ? ((a.presentDays || 0) / a.totalClasses) * 100
        : 0;
      return perc >= 60 && perc < 70;
    }).length,
    "Poor (< 60%)": attendance.filter((a) => {
      const perc = a.totalClasses
        ? ((a.presentDays || 0) / a.totalClasses) * 100
        : 0;
      return perc < 60;
    }).length,
  };

  attendanceOverviewChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: Object.keys(ranges),
      datasets: [
        {
          data: Object.values(ranges),
          backgroundColor: [
            "#10B981",
            "#3B82F6",
            "#F59E0B",
            "#EF4444",
            "#6B7280",
          ],
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Attendance Distribution",
        },
        legend: {
          position: "bottom",
        },
      },
    },
  });
}

function setupAttendanceManagement() {
  function renderAttendance(data) {
    if (!data.length) {
      document.getElementById("attendanceList").innerHTML = `
        <div class="text-center py-12">
          <div class="text-6xl mb-4">📄</div>
          <p class="text-gray-500 text-lg">No attendance records found</p>
          <button onclick="showAddAttendanceForm()" class="mt-4 px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold">
            Add First Student
          </button>
        </div>
      `;
      return;
    }

    document.getElementById("attendanceList").innerHTML = `
      <table class="min-w-full">
        <thead>
          <tr class="bg-gradient-to-r from-green-50 to-teal-50">
            <th class="p-4 text-left font-bold text-gray-700">Student Info</th>
            <th class="p-4 text-left font-bold text-gray-700">Course Details</th>
            <th class="p-4 text-left font-bold text-gray-700">Attendance Stats</th>
            <th class="p-4 text-left font-bold text-gray-700">Quick Actions</th>
            <th class="p-4 text-left font-bold text-gray-700">Manage</th>
          </tr>
        </thead>
        <tbody>
          ${data
            .map((a) => {
              const attendancePercentage = a.totalClasses
                ? Math.round(((a.presentDays || 0) / a.totalClasses) * 100)
                : 0;
              const statusColor =
                attendancePercentage >= 75
                  ? "text-green-600"
                  : attendancePercentage >= 60
                  ? "text-yellow-600"
                  : "text-red-600";
              const statusBg =
                attendancePercentage >= 75
                  ? "bg-green-50"
                  : attendancePercentage >= 60
                  ? "bg-yellow-50"
                  : "bg-red-50";

              return `
              <tr class="hover:bg-green-50/30 transition-all border-b border-gray-100">
                <td class="p-4">
                  <div class="flex items-center gap-3">
                    <div class="w-10 h-10 bg-gradient-to-br from-green-400 to-teal-500 rounded-full flex items-center justify-center text-white font-bold">
                      ${a.studentName.charAt(0)}
                    </div>
                    <div>
                      <div class="font-semibold text-gray-900">${
                        a.studentName
                      }</div>
                      <div class="text-sm text-gray-500">ID: ${
                        a.studentId || "N/A"
                      }</div>
                    </div>
                  </div>
                </td>
                <td class="p-4">
                  <div class="font-medium text-gray-900">${a.course}</div>
                  <div class="text-sm text-gray-500">Section: ${a.section}</div>
                </td>
                <td class="p-4">
                  <div class="flex items-center gap-4">
                    <div class="${statusBg} px-3 py-2 rounded-lg">
                      <div class="font-bold ${statusColor} text-lg">${attendancePercentage}%</div>
                      <div class="text-xs text-gray-500">Overall</div>
                    </div>
                    <div class="text-sm text-gray-600">
                      <div>Present: <span class="font-semibold text-green-600">${
                        a.presentDays || 0
                      }</span></div>
                      <div>Absent: <span class="font-semibold text-red-600">${
                        a.absentDays || 0
                      }</span></div>
                      <div>Total: <span class="font-semibold">${
                        a.totalClasses || 0
                      }</span></div>
                    </div>
                  </div>
                </td>
                <td class="p-4">
                  <div class="flex gap-2">
                    <button onclick="markAttendance('${
                      a.id
                    }', true)" class="px-4 py-2 bg-green-100 hover:bg-green-200 text-green-700 rounded-lg font-semibold transition-all text-sm">
                      ✅ Present
                    </button>
                    <button onclick="markAttendance('${
                      a.id
                    }', false)" class="px-4 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg font-semibold transition-all text-sm">
                      ❌ Absent
                    </button>
                  </div>
                </td>
                <td class="p-4">
                  <div class="flex gap-2">
                    <button onclick="editAttendance('${
                      a.id
                    }')" class="px-3 py-2 bg-blue-100 hover:bg-blue-200 text-blue-600 rounded-lg text-sm font-medium transition-all">
                      ✏️ Edit
                    </button>
                    <button onclick="deleteAttendanceRecord('${
                      a.id
                    }')" class="px-3 py-2 bg-red-100 hover:bg-red-200 text-red-600 rounded-lg text-sm font-medium transition-all">
                      🗑️ Delete
                    </button>
                  </div>
                </td>
              </tr>
            `;
            })
            .join("")}
        </tbody>
      </table>
    `;
  }

  // Load attendance records
  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      renderAttendance(attendance);
      populateAttendanceFilters(attendance);
    });

  // Search functionality
  document.getElementById("attendanceSearch").addEventListener("input", (e) => {
    const search = e.target.value.toLowerCase();
    mockFirestore
      .collection("attendance")
      .get()
      .then((attendance) => {
        const filtered = attendance.filter(
          (a) =>
            a.studentName.toLowerCase().includes(search) ||
            a.course.toLowerCase().includes(search) ||
            a.section.toLowerCase().includes(search) ||
            (a.studentId && a.studentId.toLowerCase().includes(search))
        );
        renderAttendance(filtered);
      });
  });
}

// Attendance CRUD Functions
window.markAttendance = async function (id, present) {
  try {
    const attendance = await mockFirestore.collection("attendance").get();
    const record = attendance.find((a) => a.id === id);
    if (record) {
      const updatedData = {
        presentDays: (record.presentDays || 0) + (present ? 1 : 0),
        absentDays: (record.absentDays || 0) + (present ? 0 : 1),
        totalClasses: (record.totalClasses || 0) + 1,
        lastAttendance: new Date(),
        lastAttendanceStatus: present ? "Present" : "Absent",
      };
      await mockFirestore.collection("attendance").update(id, updatedData);
      showToast(
        `Marked ${present ? "Present" : "Absent"} successfully!`,
        "success"
      );
      setupAttendanceManagement();
      loadAttendanceOverview();
    }
  } catch (error) {
    showToast("Error marking attendance: " + error.message, "error");
  }
};

window.deleteAttendanceRecord = async function (id) {
  if (
    !confirm(
      "Are you sure you want to delete this attendance record? This action cannot be undone."
    )
  )
    return;

  try {
    await mockFirestore.collection("attendance").delete(id);
    showToast("Attendance record deleted successfully!", "success");
    setupAttendanceManagement();
    loadAttendanceOverview();
  } catch (error) {
    showToast("Error deleting attendance record: " + error.message, "error");
  }
};

window.editAttendance = function (id) {
  showEditAttendanceForm(id);
};

window.showAddAttendanceForm = function () {
  const formModal = document.createElement("div");
  formModal.id = "addAttendanceModal";
  formModal.className =
    "fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
  formModal.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
      <div class="flex items-center justify-between mb-6">
        <h3 class="text-2xl font-bold text-gray-800">➕ Add Student Record</h3>
        <button onclick="closeAddAttendanceForm()" class="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-300">✕</button>
      </div>
      <form id="addAttendanceForm" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Student Name</label>
          <input type="text" id="attStudentName" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-2">Student ID</label>
          <input type="text" id="attStudentId" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Course</label>
            <input type="text" id="attCourse" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Section</label>
            <input type="text" id="attSection" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
        </div>
        <div class="grid grid-cols-3 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Present Days</label>
            <input type="number" id="attPresentDays" min="0" value="0" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Absent Days</label>
            <input type="number" id="attAbsentDays" min="0" value="0" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Total Classes</label>
            <input type="number" id="attTotalClasses" min="0" value="0" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
        </div>
        <div class="flex gap-4 pt-4">
          <button type="submit" class="flex-1 px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all">
            Add Record
          </button>
          <button type="button" onclick="closeAddAttendanceForm()" class="flex-1 px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-xl font-semibold transition-all">
            Cancel
          </button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(formModal);

  document
    .getElementById("addAttendanceForm")
    .addEventListener("submit", async (e) => {
      e.preventDefault();

      const attendanceData = {
        studentName: document.getElementById("attStudentName").value,
        studentId: document.getElementById("attStudentId").value,
        course: document.getElementById("attCourse").value,
        section: document.getElementById("attSection").value,
        presentDays:
          parseInt(document.getElementById("attPresentDays").value) || 0,
        absentDays:
          parseInt(document.getElementById("attAbsentDays").value) || 0,
        totalClasses:
          parseInt(document.getElementById("attTotalClasses").value) || 0,
        createdAt: new Date(),
        lastAttendance: new Date(),
      };

      try {
        await mockFirestore.collection("attendance").add(attendanceData);
        showToast("Attendance record added successfully!", "success");
        closeAddAttendanceForm();
        setupAttendanceManagement();
        loadAttendanceOverview();
      } catch (error) {
        showToast("Error adding attendance record: " + error.message, "error");
      }
    });
};

window.closeAddAttendanceForm = function () {
  document.getElementById("addAttendanceModal")?.remove();
};

function showEditAttendanceForm(id) {
  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      const record = attendance.find((a) => a.id === id);
      if (!record) return;

      const formModal = document.createElement("div");
      formModal.id = "editAttendanceModal";
      formModal.className =
        "fixed inset-0 z-[10001] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm";
      formModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-2xl font-bold text-gray-800">✏️ Edit Attendance Record</h3>
          <button onclick="closeEditAttendanceForm()" class="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-gray-600 hover:bg-gray-300">✕</button>
        </div>
        <form id="editAttendanceForm" class="space-y-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Student Name</label>
            <input type="text" id="editAttStudentName" value="${
              record.studentName
            }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-2">Student ID</label>
            <input type="text" id="editAttStudentId" value="${
              record.studentId || ""
            }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
          </div>
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Course</label>
              <input type="text" id="editAttCourse" value="${
                record.course
              }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Section</label>
              <input type="text" id="editAttSection" value="${
                record.section
              }" required class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
            </div>
          </div>
          <div class="grid grid-cols-3 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Present Days</label>
              <input type="number" id="editAttPresentDays" value="${
                record.presentDays || 0
              }" min="0" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Absent Days</label>
              <input type="number" id="editAttAbsentDays" value="${
                record.absentDays || 0
              }" min="0" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-2">Total Classes</label>
              <input type="number" id="editAttTotalClasses" value="${
                record.totalClasses || 0
              }" min="0" class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-green-500 focus:outline-none">
            </div>
          </div>
          <div class="flex gap-4 pt-4">
            <button type="submit" class="flex-1 px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold transition-all">
              Update Record
            </button>
            <button type="button" onclick="closeEditAttendanceForm()" class="flex-1 px-6 py-3 bg-gray-300 hover:bg-gray-400 text-gray-700 rounded-xl font-semibold transition-all">
              Cancel
            </button>
          </div>
        </form>
      </div>
    `;
      document.body.appendChild(formModal);

      document
        .getElementById("editAttendanceForm")
        .addEventListener("submit", async (e) => {
          e.preventDefault();

          const updatedData = {
            studentName: document.getElementById("editAttStudentName").value,
            studentId: document.getElementById("editAttStudentId").value,
            course: document.getElementById("editAttCourse").value,
            section: document.getElementById("editAttSection").value,
            presentDays:
              parseInt(document.getElementById("editAttPresentDays").value) ||
              0,
            absentDays:
              parseInt(document.getElementById("editAttAbsentDays").value) || 0,
            totalClasses:
              parseInt(document.getElementById("editAttTotalClasses").value) ||
              0,
            updatedAt: new Date(),
          };

          try {
            await mockFirestore
              .collection("attendance")
              .update(id, updatedData);
            showToast("Attendance record updated successfully!", "success");
            closeEditAttendanceForm();
            setupAttendanceManagement();
            loadAttendanceOverview();
          } catch (error) {
            showToast(
              "Error updating attendance record: " + error.message,
              "error"
            );
          }
        });
    });
}

window.closeEditAttendanceForm = function () {
  document.getElementById("editAttendanceModal")?.remove();
};

function populateAttendanceFilters(attendance) {
  const courses = [...new Set(attendance.map((a) => a.course))];
  const sections = [...new Set(attendance.map((a) => a.section))];

  const courseFilter = document.getElementById("attendanceCourseFilter");
  const sectionFilter = document.getElementById("attendanceSectionFilter");
  const markCourseSelect = document.getElementById("markCourseSelect");
  const markSectionSelect = document.getElementById("markSectionSelect");

  [courseFilter, markCourseSelect].forEach((select) => {
    if (select) {
      const currentValue = select.value;
      select.innerHTML = '<option value="">All Courses</option>';
      courses.forEach((course) => {
        const option = document.createElement("option");
        option.value = course;
        option.textContent = course;
        if (course === currentValue) option.selected = true;
        select.appendChild(option);
      });
    }
  });

  [sectionFilter, markSectionSelect].forEach((select) => {
    if (select) {
      const currentValue = select.value;
      select.innerHTML = '<option value="">All Sections</option>';
      sections.forEach((section) => {
        const option = document.createElement("option");
        option.value = section;
        option.textContent = section;
        if (section === currentValue) option.selected = true;
        select.appendChild(option);
      });
    }
  });
}

function setupAttendanceMarking() {
  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      populateAttendanceFilters(attendance);
    });
}

window.loadStudentsForAttendance = function () {
  const course = document.getElementById("markCourseSelect").value;
  const section = document.getElementById("markSectionSelect").value;
  const date = document.getElementById("attendanceDate").value;

  if (!course || !section) {
    showToast("Please select both course and section", "error");
    return;
  }

  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      const students = attendance.filter(
        (a) => a.course === course && a.section === section
      );

      if (students.length === 0) {
        document.getElementById("attendanceMarkingArea").innerHTML = `
        <div class="text-center py-12 text-gray-500">
          <div class="text-6xl mb-4">🚫</div>
          <p>No students found for ${course} - Section ${section}</p>
          <button onclick="showAddAttendanceForm()" class="mt-4 px-6 py-3 bg-green-500 hover:bg-green-600 text-white rounded-xl font-semibold">
            Add Students
          </button>
        </div>
      `;
        return;
      }

      document.getElementById("attendanceMarkingArea").innerHTML = `
      <div class="mb-6">
        <h3 class="text-xl font-bold text-gray-700 mb-2">Mark Attendance - ${course} (Section ${section})</h3>
        <p class="text-gray-600">Date: ${new Date(
          date
        ).toLocaleDateString()}</p>
        <div class="flex gap-4 mt-4">
          <button onclick="markAllPresent()" class="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-semibold">
            ✅ Mark All Present
          </button>
          <button onclick="markAllAbsent()" class="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold">
            ❌ Mark All Absent
          </button>
          <button onclick="saveAttendance()" class="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-semibold">
            💾 Save Attendance
          </button>
        </div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="studentAttendanceGrid">
        ${students
          .map(
            (student) => `
          <div class="bg-white border-2 border-gray-200 rounded-xl p-4 hover:shadow-lg transition-all" data-student-id="${
            student.id
          }">
            <div class="flex items-center gap-3 mb-3">
              <div class="w-12 h-12 bg-gradient-to-br from-green-400 to-teal-500 rounded-full flex items-center justify-center text-white font-bold text-lg">
                ${student.studentName.charAt(0)}
              </div>
              <div>
                <div class="font-semibold text-gray-900">${
                  student.studentName
                }</div>
                <div class="text-sm text-gray-500">ID: ${
                  student.studentId
                }</div>
              </div>
            </div>
            <div class="flex gap-2">
              <button onclick="toggleAttendanceStatus(this, '${
                student.id
              }', true)" class="attendance-btn flex-1 px-3 py-2 border-2 border-green-200 text-green-600 rounded-lg font-semibold transition-all hover:bg-green-50">
                ✅ Present
              </button>
              <button onclick="toggleAttendanceStatus(this, '${
                student.id
              }', false)" class="attendance-btn flex-1 px-3 py-2 border-2 border-red-200 text-red-600 rounded-lg font-semibold transition-all hover:bg-red-50">
                ❌ Absent
              </button>
            </div>
            <input type="hidden" class="attendance-status" value="">
          </div>
        `
          )
          .join("")}
      </div>
    `;
    });
};

window.toggleAttendanceStatus = function (button, studentId, status) {
  const studentCard = button.closest("[data-student-id]");
  const buttons = studentCard.querySelectorAll(".attendance-btn");
  const statusInput = studentCard.querySelector(".attendance-status");

  // Reset all buttons
  buttons.forEach((btn) => {
    btn.classList.remove("bg-green-500", "text-white", "bg-red-500");
    btn.classList.add("border-2");
  });

  // Highlight selected button
  if (status) {
    button.classList.remove("border-green-200", "text-green-600");
    button.classList.add("bg-green-500", "text-white");
    statusInput.value = "present";
  } else {
    button.classList.remove("border-red-200", "text-red-600");
    button.classList.add("bg-red-500", "text-white");
    statusInput.value = "absent";
  }
};

window.markAllPresent = function () {
  const presentButtons = document.querySelectorAll(
    ".attendance-btn:nth-child(1)"
  );
  presentButtons.forEach((btn) => {
    const studentId = btn.closest("[data-student-id]").dataset.studentId;
    toggleAttendanceStatus(btn, studentId, true);
  });
};

window.markAllAbsent = function () {
  const absentButtons = document.querySelectorAll(
    ".attendance-btn:nth-child(2)"
  );
  absentButtons.forEach((btn) => {
    const studentId = btn.closest("[data-student-id]").dataset.studentId;
    toggleAttendanceStatus(btn, studentId, false);
  });
};

window.saveAttendance = async function () {
  const studentCards = document.querySelectorAll("[data-student-id]");
  const updates = [];

  for (const card of studentCards) {
    const studentId = card.dataset.studentId;
    const status = card.querySelector(".attendance-status").value;

    if (status) {
      const isPresent = status === "present";
      updates.push(markAttendance(studentId, isPresent));
    }
  }

  try {
    await Promise.all(updates);
    showToast("Attendance saved successfully!", "success");
  } catch (error) {
    showToast("Error saving attendance: " + error.message, "error");
  }
};

function loadAttendanceAnalytics() {
  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      if (typeof Chart !== "undefined") {
        createAttendanceTrendsChart(attendance);
        createCourseAttendanceChart(attendance);
      }
      createAttendanceDetailedAnalytics(attendance);
    });
}

function createAttendanceTrendsChart(attendance) {
  const ctx = document
    .getElementById("attendanceTrendsChart")
    ?.getContext("2d");
  if (!ctx) return;

  if (
    window.attendanceTrendsChart &&
    typeof window.attendanceTrendsChart.destroy === "function"
  ) {
    window.attendanceTrendsChart.destroy();
  }

  // Mock trend data
  const trendData = [
    { period: "Week 1", attendance: 85 },
    { period: "Week 2", attendance: 88 },
    { period: "Week 3", attendance: 82 },
    { period: "Week 4", attendance: 90 },
    { period: "Week 5", attendance: 87 },
    { period: "Week 6", attendance: 89 },
  ];

  window.attendanceTrendsChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: trendData.map((d) => d.period),
      datasets: [
        {
          label: "Attendance Percentage",
          data: trendData.map((d) => d.attendance),
          borderColor: "#10B981",
          backgroundColor: "rgba(16, 185, 129, 0.1)",
          tension: 0.4,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Attendance Trends Over Time",
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
        },
      },
    },
  });
}

function createCourseAttendanceChart(attendance) {
  const ctx = document
    .getElementById("courseAttendanceChart")
    ?.getContext("2d");
  if (!ctx) return;

  if (
    courseAttendanceChart &&
    typeof courseAttendanceChart.destroy === "function"
  ) {
    courseAttendanceChart.destroy();
  }

  // Group by course
  const courseData = {};
  attendance.forEach((record) => {
    if (!courseData[record.course]) courseData[record.course] = [];
    const percentage = record.totalClasses
      ? ((record.presentDays || 0) / record.totalClasses) * 100
      : 0;
    courseData[record.course].push(percentage);
  });

  const courses = Object.keys(courseData);
  const avgAttendance = courses.map((course) => {
    const percentages = courseData[course];
    return (
      percentages.reduce((sum, perc) => sum + perc, 0) / percentages.length
    );
  });

  courseAttendanceChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: courses,
      datasets: [
        {
          label: "Average Attendance %",
          data: avgAttendance,
          backgroundColor: [
            "#10B981",
            "#3B82F6",
            "#F59E0B",
            "#EF4444",
            "#8B5CF6",
            "#EC4899",
          ],
          borderRadius: 8,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "Course-wise Attendance Performance",
        },
        legend: {
          display: false,
        },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
        },
      },
    },
  });
}

function createAttendanceDetailedAnalytics(attendance) {
  const container = document.getElementById("attendanceDetailedAnalytics");
  if (!container) return;

  const totalStudents = attendance.length;
  let totalPresent = 0,
    totalClasses = 0;

  attendance.forEach((record) => {
    totalPresent += record.presentDays || 0;
    totalClasses += record.totalClasses || 0;
  });

  const overallAttendance = totalClasses
    ? ((totalPresent / totalClasses) * 100).toFixed(1)
    : 0;
  const excellentAttendance = attendance.filter((record) => {
    const perc = record.totalClasses
      ? ((record.presentDays || 0) / record.totalClasses) * 100
      : 0;
    return perc >= 90;
  }).length;

  const lowAttendance = attendance.filter((record) => {
    const perc = record.totalClasses
      ? ((record.presentDays || 0) / record.totalClasses) * 100
      : 0;
    return perc < 75;
  }).length;

  container.innerHTML = `
    <div class="bg-blue-50 p-4 rounded-xl text-center">
      <div class="text-2xl font-bold text-blue-600">${overallAttendance}%</div>
      <div class="text-sm text-blue-500">Overall Attendance</div>
    </div>
    <div class="bg-green-50 p-4 rounded-xl text-center">
      <div class="text-2xl font-bold text-green-600">${excellentAttendance}</div>
      <div class="text-sm text-green-500">Excellent (90%+)</div>
    </div>
    <div class="bg-red-50 p-4 rounded-xl text-center">
      <div class="text-2xl font-bold text-red-600">${lowAttendance}</div>
      <div class="text-sm text-red-500">Below 75%</div>
    </div>
  `;
}

// Attendance Export Functions
window.exportAttendanceCSV = function () {
  mockFirestore
    .collection("attendance")
    .get()
    .then((attendance) => {
      let csv =
        "Student Name,Student ID,Course,Section,Present Days,Absent Days,Total Classes,Attendance Percentage,Last Attendance\n";
      attendance.forEach((record) => {
        const percentage = record.totalClasses
          ? Math.round(((record.presentDays || 0) / record.totalClasses) * 100)
          : 0;
        csv += `"${record.studentName}","${record.studentId || ""}","${
          record.course
        }","${record.section}","${record.presentDays || 0}","${
          record.absentDays || 0
        }","${record.totalClasses || 0}","${percentage}%","${
          record.lastAttendance
            ? new Date(record.lastAttendance).toLocaleDateString()
            : ""
        }"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `attendance_export_${
        new Date().toISOString().split("T")[0]
      }.csv`;
      a.click();
      window.URL.revokeObjectURL(url);

      showToast("CSV exported successfully!", "success");
    });
};

window.exportAttendanceExcel = function () {
  exportAttendanceCSV();
  showToast("Excel export completed! (CSV format)", "success");
};

window.sendAttendanceReport = function () {
  showToast("Email feature would be integrated with backend service", "info");
};

window.printAttendanceReport = function () {
  window.print();
};

window.generateAttendancePDF = function () {
  showToast("PDF generation feature requires jsPDF library", "info");
};

// Modal close function
window.closeModal = function (modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove("active");
    setTimeout(() => {
      modal.remove();
    }, 300);
  }
};

// Toast notification function
function showGradeToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `fixed top-4 right-4 z-[10002] px-6 py-4 rounded-xl shadow-lg text-white font-semibold transition-all transform translate-x-full opacity-0`;

  const colors = {
    success: "bg-green-500",
    error: "bg-red-500",
    warning: "bg-yellow-500",
    info: "bg-blue-500",
  };

  toast.classList.add(colors[type] || colors.info);
  toast.textContent = message;

  document.body.appendChild(toast);

  // Animate in
  setTimeout(() => {
    toast.classList.remove("translate-x-full", "opacity-0");
  }, 100);

  // Remove after 3 seconds
  setTimeout(() => {
    toast.classList.add("translate-x-full", "opacity-0");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Initialize global functions
window.showGrades = showGrades;
window.showAttendance = showAttendance;

// Event listeners for navigation buttons
document.addEventListener("DOMContentLoaded", function () {
  const gradesNav = document.getElementById("gradesNav");
  const attendanceNav = document.getElementById("attendanceNav");

  if (gradesNav) {
    gradesNav.addEventListener("click", function (e) {
      e.preventDefault();
      showGrades();
    });
  }

  if (attendanceNav) {
    attendanceNav.addEventListener("click", function (e) {
      e.preventDefault();
      showAttendance();
    });
  }
});

// Usage Example:
// To use this system, you need to:
// 1. Include Chart.js for charts: <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js"></script>
// 2. Include Tailwind CSS for styling
// 3. Create buttons or links that call showGrades() and showAttendance()
// 4. For PDF generation, include jsPDF: <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>

console.log("Grade & Attendance Management System loaded successfully!");
console.log(
  "Usage: Call showGrades() or showAttendance() to open the respective modals"
);
