// Enhanced Dashboard System v2.0 - CollegeConnect Role-Based Platform
import { auth, db } from './firebase-config.js';
import { 
  onAuthStateChanged, 
  signOut, 
  updatePassword, 
  reauthenticateWithCredential, 
  EmailAuthProvider 
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import { 
  doc, 
  getDoc, 
  getDocs,
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  addDoc, 
  serverTimestamp, 
  runTransaction, 
  deleteDoc,
  updateDoc,
  where,
  limit,
  setDoc
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// Global state management
let currentUser = null;
let currentUserData = null;
let realTimeListeners = new Map();

// Enhanced role-based permissions system
const PERMISSIONS = {
  student: {
    canCreateNotes: false,
    canDeleteNotes: false,
    canCreatePolls: false,
    canDeletePolls: false,
    canCreateEvents: false,
    canDeleteEvents: false,
    canCreateTimetable: false,
    canDeleteTimetable: false,
    canManageUsers: false,
    canViewAnalytics: false,
    canAccessAdminPanel: false,
    canVotePolls: true,
    canViewNotes: true,
    canChat: true,
    canViewTimetable: true,
    canViewEvents: true,
    canEditOwnContent: true,
    canReportContent: true
  },
  faculty: {
    canCreateNotes: true,
    canDeleteNotes: true,
    canCreatePolls: true,
    canDeletePolls: true,
    canCreateEvents: true,
    canDeleteEvents: true,
    canCreateTimetable: true,
    canDeleteTimetable: true,
    canManageUsers: false,
    canViewAnalytics: true,
    canAccessAdminPanel: false,
    canVotePolls: true,
    canViewNotes: true,
    canChat: true,
    canViewTimetable: true,
    canViewEvents: true,
    canEditOwnContent: true,
    canReportContent: true,
    canModerateContent: true
  },
  admin: {
    canCreateNotes: true,
    canDeleteNotes: true,
    canCreatePolls: true,
    canDeletePolls: true,
    canCreateEvents: true,
    canDeleteEvents: true,
    canCreateTimetable: true,
    canDeleteTimetable: true,
    canManageUsers: true,
    canViewAnalytics: true,
    canAccessAdminPanel: true,
    canVotePolls: true,
    canViewNotes: true,
    canChat: true,
    canViewTimetable: true,
    canViewEvents: true,
    canEditOwnContent: true,
    canReportContent: true,
    canModerateContent: true,
    canDeleteAnyContent: true,
    canBanUsers: true
  }
};

// Check if user has specific permission
function hasPermission(permission) {
  if (!currentUserData) return false;
  return PERMISSIONS[currentUserData.role]?.[permission] || false;
}

// Enhanced role-based themes
const ROLE_THEMES = {
  student: {
    name: 'Student',
    primaryColor: 'blue',
    gradientFrom: 'from-blue-500',
    gradientTo: 'to-indigo-600',
    hoverFrom: 'hover:from-blue-600',
    hoverTo: 'hover:to-indigo-700',
    bgLight: 'bg-blue-50',
    bgMedium: 'bg-blue-100',
    textColor: 'text-blue-600',
    borderColor: 'border-blue-200',
    accentBg: 'bg-blue-100',
    emoji: '👨‍🎓',
    lightPattern: 'bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50'
  },
  faculty: {
    name: 'Faculty',
    primaryColor: 'green',
    gradientFrom: 'from-green-500',
    gradientTo: 'to-emerald-600',
    hoverFrom: 'hover:from-green-600',
    hoverTo: 'hover:to-emerald-700',
    bgLight: 'bg-green-50',
    bgMedium: 'bg-green-100',
    textColor: 'text-green-600',
    borderColor: 'border-green-200',
    accentBg: 'bg-green-100',
    emoji: '👨‍🏫',
    lightPattern: 'bg-gradient-to-br from-green-50 via-emerald-50 to-teal-50'
  },
  admin: {
    name: 'Administrator',
    primaryColor: 'purple',
    gradientFrom: 'from-purple-500',
    gradientTo: 'to-red-500',
    hoverFrom: 'hover:from-purple-600',
    hoverTo: 'hover:to-red-600',
    bgLight: 'bg-purple-50',
    bgMedium: 'bg-purple-100',
    textColor: 'text-purple-600',
    borderColor: 'border-purple-200',
    accentBg: 'bg-purple-100',
    emoji: '👨‍💼',
    lightPattern: 'bg-gradient-to-br from-purple-50 via-pink-50 to-red-50'
  }
};

// Enhanced User Profile Management
class UserProfileManager {
  static showUserProfile() {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    const profileModal = document.createElement('div');
    profileModal.id = 'userProfileModal';
    profileModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 backdrop-blur-sm';
    
    profileModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-auto">
        <div class="sticky top-0 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white p-6 rounded-t-2xl">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
              <div class="w-16 h-16 bg-white bg-opacity-20 rounded-full flex items-center justify-center text-3xl">
                ${theme.emoji}
              </div>
              <div>
                <h2 class="text-2xl font-bold">My Profile</h2>
                <p class="text-white text-opacity-90">${theme.name} Dashboard</p>
              </div>
            </div>
            <button onclick="this.closest('.fixed').remove()" 
                    class="text-white hover:bg-white hover:bg-opacity-20 w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200">
              ✕
            </button>
          </div>
        </div>
        
        <div class="p-6">
          <!-- Profile Information Section -->
          <div class="mb-8">
            <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>👤</span> Profile Information
            </h3>
            <div class="bg-gray-50 rounded-xl p-6 space-y-4">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
                  <input type="text" id="profileDisplayName" 
                         class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                         value="${currentUserData?.displayName || ''}" placeholder="Enter your full name">
                </div>
                <div>
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
                  <input type="email" readonly 
                         class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-100 text-gray-600"
                         value="${currentUser?.email || ''}">
                </div>
                <div>
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Role</label>
                  <input type="text" readonly 
                         class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl bg-gray-100 text-gray-600 capitalize"
                         value="${currentUserData?.role || 'student'}">
                </div>
                <div>
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Student ID / Employee ID</label>
                  <input type="text" id="profileUserId" 
                         class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                         value="${currentUserData?.userId || ''}" placeholder="Enter your ID">
                </div>
                <div>
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Department</label>
                  <input type="text" id="profileDepartment" 
                         class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                         value="${currentUserData?.department || ''}" placeholder="Enter your department">
                </div>
                <div>
                  <label class="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
                  <input type="tel" id="profilePhone" 
                         class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                         value="${currentUserData?.phone || ''}" placeholder="Enter your phone number">
                </div>
              </div>
              
              <div>
                <label class="block text-sm font-semibold text-gray-700 mb-2">Bio</label>
                <textarea id="profileBio" rows="3" 
                          class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors resize-none"
                          placeholder="Tell us about yourself...">${currentUserData?.bio || ''}</textarea>
              </div>
              
              <div class="pt-4">
                <button onclick="UserProfileManager.updateProfile()" 
                        class="bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white px-6 py-3 rounded-xl ${theme.hoverFrom} ${theme.hoverTo} transition-all duration-200 transform hover:scale-105 shadow-lg font-semibold flex items-center gap-2">
                  <span>💾</span> Update Profile
                </button>
              </div>
            </div>
          </div>
          
          <!-- Account Statistics -->
          <div class="mb-8">
            <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>📊</span> Account Statistics
            </h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div class="bg-blue-50 p-4 rounded-xl text-center">
                <div class="text-2xl font-bold text-blue-600" id="userNotesCount">0</div>
                <div class="text-sm text-blue-600">Notes</div>
              </div>
              <div class="bg-green-50 p-4 rounded-xl text-center">
                <div class="text-2xl font-bold text-green-600" id="userPollsCount">0</div>
                <div class="text-sm text-green-600">Polls</div>
              </div>
              <div class="bg-purple-50 p-4 rounded-xl text-center">
                <div class="text-2xl font-bold text-purple-600" id="userMessagesCount">0</div>
                <div class="text-sm text-purple-600">Messages</div>
              </div>
              <div class="bg-orange-50 p-4 rounded-xl text-center">
                <div class="text-2xl font-bold text-orange-600" id="userDaysActive">0</div>
                <div class="text-sm text-orange-600">Days Active</div>
              </div>
            </div>
          </div>
          
          <!-- Account Actions -->
          <div class="space-y-4">
            <h3 class="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
              <span>⚙️</span> Account Actions
            </h3>
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button onclick="UserProfileManager.showChangePasswordModal()" 
                      class="bg-yellow-100 text-yellow-800 p-4 rounded-xl hover:bg-yellow-200 transition-all duration-200 flex items-center gap-3 font-semibold">
                <span class="text-2xl">🔐</span>
                <div class="text-left">
                  <div>Change Password</div>
                  <div class="text-sm opacity-75">Update your account password</div>
                </div>
              </button>
              
              <button onclick="UserProfileManager.confirmLogout()" 
                      class="bg-red-100 text-red-800 p-4 rounded-xl hover:bg-red-200 transition-all duration-200 flex items-center gap-3 font-semibold">
                <span class="text-2xl">🚪</span>
                <div class="text-left">
                  <div>Logout</div>
                  <div class="text-sm opacity-75">Sign out of your account</div>
                </div>
              </button>
            </div>
          </div>
          
          <!-- Account Details -->
          <div class="mt-8 pt-6 border-t border-gray-200 text-sm text-gray-500">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <span class="font-medium">Member Since:</span>
                <div>${currentUserData?.createdAt ? new Date(currentUserData.createdAt.seconds * 1000).toLocaleDateString() : 'Unknown'}</div>
              </div>
              <div>
                <span class="font-medium">Last Login:</span>
                <div>${currentUserData?.lastLogin ? new Date(currentUserData.lastLogin.seconds * 1000).toLocaleDateString() : 'Today'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(profileModal);
    this.loadUserStats();
  }
  
  static async updateProfile() {
    const displayName = document.getElementById('profileDisplayName').value.trim();
    const userId = document.getElementById('profileUserId').value.trim();
    const department = document.getElementById('profileDepartment').value.trim();
    const phone = document.getElementById('profilePhone').value.trim();
    const bio = document.getElementById('profileBio').value.trim();
    
    if (!displayName) {
      showMessage('❌ Please enter your full name', 'error');
      return;
    }
    
    try {
      const userRef = doc(db, 'users', currentUser.uid);
      await updateDoc(userRef, {
        displayName,
        userId,
        department,
        phone,
        bio,
        updatedAt: serverTimestamp()
      });
      
      // Update local user data
      currentUserData = {
        ...currentUserData,
        displayName,
        userId,
        department,
        phone,
        bio
      };
      
      updateUserUI();
      showMessage('✅ Profile updated successfully!', 'success');
      document.getElementById('userProfileModal')?.remove();
    } catch (error) {
      console.error('Error updating profile:', error);
      showMessage('❌ Failed to update profile', 'error');
    }
  }
  
  static showChangePasswordModal() {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    const passwordModal = document.createElement('div');
    passwordModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60 backdrop-blur-sm';
    
    passwordModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4">
        <div class="bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white p-6 rounded-t-2xl">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-bold flex items-center gap-2">
              <span>🔐</span> Change Password
            </h3>
            <button onclick="this.closest('.fixed').remove()" 
                    class="text-white hover:bg-white hover:bg-opacity-20 w-8 h-8 rounded-full flex items-center justify-center">
              ✕
            </button>
          </div>
        </div>
        
        <form onsubmit="UserProfileManager.changePassword(event)" class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Current Password</label>
            <input type="password" id="currentPassword" required
                   class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                   placeholder="Enter your current password">
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">New Password</label>
            <input type="password" id="newPassword" required minlength="6"
                   class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                   placeholder="Enter your new password (min 6 characters)">
          </div>
          
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Confirm New Password</label>
            <input type="password" id="confirmPassword" required minlength="6"
                   class="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:outline-none focus:border-${theme.primaryColor}-500 transition-colors"
                   placeholder="Confirm your new password">
          </div>
          
          <div class="flex gap-3 pt-4">
            <button type="button" onclick="this.closest('.fixed').remove()" 
                    class="flex-1 bg-gray-100 text-gray-700 py-3 px-6 rounded-xl hover:bg-gray-200 transition-all duration-200 font-semibold">
              Cancel
            </button>
            <button type="submit" 
                    class="flex-1 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white py-3 px-6 rounded-xl ${theme.hoverFrom} ${theme.hoverTo} transition-all duration-200 font-semibold transform hover:scale-105 shadow-lg">
              🔄 Update Password
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(passwordModal);
  }
  
  static async changePassword(event) {
    event.preventDefault();
    
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (newPassword !== confirmPassword) {
      showMessage('❌ New passwords do not match', 'error');
      return;
    }
    
    if (newPassword.length < 6) {
      showMessage('❌ Password must be at least 6 characters long', 'error');
      return;
    }
    
    try {
      // Re-authenticate user
      const credential = EmailAuthProvider.credential(currentUser.email, currentPassword);
      await reauthenticateWithCredential(currentUser, credential);
      
      // Update password
      await updatePassword(currentUser, newPassword);
      
      showMessage('✅ Password changed successfully!', 'success');
      event.target.closest('.fixed').remove();
    } catch (error) {
      console.error('Error changing password:', error);
      if (error.code === 'auth/wrong-password') {
        showMessage('❌ Current password is incorrect', 'error');
      } else {
        showMessage('❌ Failed to change password. Please try again.', 'error');
      }
    }
  }
  
  static confirmLogout() {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    const confirmModal = document.createElement('div');
    confirmModal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60 backdrop-blur-sm';
    
    confirmModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4">
        <div class="p-8 text-center">
          <div class="text-6xl mb-4">👋</div>
          <h3 class="text-2xl font-bold text-gray-800 mb-4">Logout Confirmation</h3>
          <p class="text-gray-600 mb-8">Are you sure you want to sign out of your account?</p>
          
          <div class="flex gap-4">
            <button onclick="this.closest('.fixed').remove()" 
                    class="flex-1 bg-gray-100 text-gray-700 py-3 px-6 rounded-xl hover:bg-gray-200 transition-all duration-200 font-semibold">
              Cancel
            </button>
            <button onclick="UserProfileManager.logout()" 
                    class="flex-1 bg-gradient-to-r from-red-500 to-red-600 text-white py-3 px-6 rounded-xl hover:from-red-600 hover:to-red-700 transition-all duration-200 font-semibold transform hover:scale-105 shadow-lg">
              🚪 Logout
            </button>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(confirmModal);
  }
  
  static async logout() {
    try {
      await signOut(auth);
      showMessage('👋 Logged out successfully!', 'success');
      
      // Clean up listeners
      realTimeListeners.forEach((unsubscribe) => {
        if (typeof unsubscribe === 'function') {
          unsubscribe();
        }
      });
      realTimeListeners.clear();
      
      // Redirect to login
      window.location.href = 'index.html';
    } catch (error) {
      console.error('Error logging out:', error);
      showMessage('❌ Failed to logout. Please try again.', 'error');
    }
  }
  
  static async loadUserStats() {
    try {
      // Load user statistics
      const [notesCount, pollsCount, messagesCount] = await Promise.all([
        getDocs(query(collection(db, 'notes'), where('uploaderId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'polls'), where('creatorId', '==', currentUser.uid))),
        getDocs(query(collection(db, 'chats'), where('userId', '==', currentUser.uid)))
      ]);
      
      document.getElementById('userNotesCount').textContent = notesCount.size;
      document.getElementById('userPollsCount').textContent = pollsCount.size;
      document.getElementById('userMessagesCount').textContent = messagesCount.size;
      
      // Calculate days active (simplified)
      const createdAt = currentUserData?.createdAt?.toDate() || new Date();
      const daysActive = Math.floor((new Date() - createdAt) / (1000 * 60 * 60 * 24));
      document.getElementById('userDaysActive').textContent = daysActive;
    } catch (error) {
      console.error('Error loading user stats:', error);
    }
  }
}

// Enhanced Dashboard Modal Manager
class EnhancedDashboardModalManager {
  constructor() {
    this.activeModals = new Set();
    this.modalStack = [];
  }
  
  openModal(templateId, options = {}) {
    console.log(`🔓 Opening modal: ${templateId}`);
    
    const template = document.getElementById(templateId);
    if (!template) {
      console.error(`❌ Modal template ${templateId} not found`);
      return null;
    }
    
    const modalRoot = document.getElementById('modalRoot');
    if (!modalRoot) {
      console.error('❌ Modal root not found');
      return null;
    }
    
    const modalWrapper = document.createElement('div');
    modalWrapper.id = `rendered-${templateId}`;
    modalWrapper.innerHTML = template.innerHTML;
    
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    modalWrapper.classList.add('role-styled-modal');
    modalWrapper.setAttribute('data-role', currentUserData?.role || 'student');
    
    modalRoot.appendChild(modalWrapper);
    
    const modal = modalWrapper.querySelector('.modal');
    if (modal) {
      modal.classList.add('show');
      modal.style.animation = 'modalSlideIn 0.3s ease-out';
    }
    
    this.activeModals.add(templateId);
    this.modalStack.push(templateId);
    document.body.style.overflow = 'hidden';
    
    this.setupModalCloseHandlers(templateId, modalWrapper);
    this.initializeModal(templateId, modalWrapper, options);
    
    return modalWrapper;
  }
  
  closeModal(templateId) {
    console.log(`🔒 Closing modal: ${templateId}`);
    
    const modalWrapper = document.getElementById(`rendered-${templateId}`);
    if (modalWrapper) {
      const modal = modalWrapper.querySelector('.modal');
      if (modal) {
        modal.style.animation = 'modalSlideOut 0.3s ease-in';
        modal.classList.remove('show');
      }
      
      setTimeout(() => {
        modalWrapper.remove();
        this.activeModals.delete(templateId);
        
        const index = this.modalStack.indexOf(templateId);
        if (index > -1) {
          this.modalStack.splice(index, 1);
        }
        
        if (this.activeModals.size === 0) {
          document.body.style.overflow = '';
        }
        
        this.cleanupModalListeners(templateId);
      }, 300);
    }
  }
  
  setupModalCloseHandlers(templateId, wrapper) {
    wrapper.querySelectorAll('.modal-close, [data-close-modal]').forEach(btn => {
      btn.addEventListener('click', () => this.closeModal(templateId));
    });
    
    wrapper.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          this.closeModal(templateId);
        }
      });
    });
    
    const escHandler = (e) => {
      if (e.key === 'Escape' && this.modalStack[this.modalStack.length - 1] === templateId) {
        this.closeModal(templateId);
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }
  
  cleanupModalListeners(templateId) {
    const listenersToRemove = [];
    realTimeListeners.forEach((unsubscribe, key) => {
      if (key.startsWith(templateId)) {
        unsubscribe();
        listenersToRemove.push(key);
      }
    });
    
    listenersToRemove.forEach(key => {
      realTimeListeners.delete(key);
    });
  }
  
  initializeModal(templateId, wrapper, options) {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    switch(templateId) {
      case 'timetableModal':
        this.initTimetableModal(wrapper, theme);
        break;
      case 'notesModal':
        this.initNotesModal(wrapper, theme);
        break;
      case 'pollsModal':
        this.initPollsModal(wrapper, theme);
        break;
      case 'chatModal':
        this.initChatModal(wrapper, theme);
        break;
    }
  }
  
  initTimetableModal(wrapper, theme) {
    console.log('Initializing timetable modal');
    this.loadTimetableData(wrapper);
  }
  
  initNotesModal(wrapper, theme) {
    console.log('Initializing notes modal');
    this.loadNotesData(wrapper);
  }
  
  initPollsModal(wrapper, theme) {
    console.log('Initializing polls modal');
    this.loadPollsData(wrapper);
  }
  
  initChatModal(wrapper, theme) {
    console.log('Initializing chat modal');
    this.initializeChatSystem(wrapper);
  }

  async loadTimetableData(wrapper) {
    try {
      const timetableQuery = query(collection(db, 'timetable'), orderBy('day'), orderBy('time'));
      const snapshot = await getDocs(timetableQuery);
      
      const timetableContainer = wrapper.querySelector('#timetableContainer');
      if (!timetableContainer) return;
      
      const timetableData = {};
      snapshot.forEach(doc => {
        const data = doc.data();
        if (!timetableData[data.day]) {
          timetableData[data.day] = [];
        }
        timetableData[data.day].push({ id: doc.id, ...data });
      });
      
      this.renderTimetable(timetableContainer, timetableData);
    } catch (error) {
      console.error('Error loading timetable:', error);
    }
  }

  renderTimetable(container, data) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    container.innerHTML = `
      <div class="grid grid-cols-1 lg:grid-cols-6 gap-4">
        ${days.map(day => `
          <div class="bg-white rounded-xl border-2 ${theme.borderColor} p-4">
            <h3 class="font-bold text-lg ${theme.textColor} mb-4 text-center">${day}</h3>
            <div class="space-y-2" id="day-${day}">
              ${data[day] ? data[day].map(item => `
                <div class="bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white p-3 rounded-lg text-sm">
                  <div class="font-semibold">${item.subject}</div>
                  <div class="text-xs opacity-90">${item.time}</div>
                  <div class="text-xs opacity-75">${item.room || 'TBA'}</div>
                </div>
              `).join('') : '<div class="text-gray-400 text-center py-4">No classes</div>'}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async loadNotesData(wrapper) {
    try {
      const notesQuery = query(collection(db, 'notes'), orderBy('createdAt', 'desc'), limit(20));
      const snapshot = await getDocs(notesQuery);
      
      const notesContainer = wrapper.querySelector('#notesContainer');
      if (!notesContainer) return;
      
      const notes = [];
      snapshot.forEach(doc => {
        notes.push({ id: doc.id, ...doc.data() });
      });
      
      this.renderNotes(notesContainer, notes);
    } catch (error) {
      console.error('Error loading notes:', error);
    }
  }

  renderNotes(container, notes) {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    if (notes.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 ${theme.bgLight} rounded-xl">
          <div class="text-6xl mb-4">📚</div>
          <h3 class="text-xl font-bold ${theme.textColor} mb-2">No Notes Available</h3>
          <p class="text-gray-500">No study materials have been shared yet.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        ${notes.map(note => `
          <div class="bg-white border-2 ${theme.borderColor} rounded-xl p-6 hover:shadow-lg transition-all duration-200 transform hover:scale-102">
            <div class="flex items-start justify-between mb-4">
              <div class="flex-1">
                <h3 class="font-bold text-lg text-gray-800 mb-2">${note.title}</h3>
                <p class="text-sm text-gray-600 mb-2">${note.description || 'No description'}</p>
                <div class="flex items-center gap-2 text-xs text-gray-500">
                  <span class="px-2 py-1 ${theme.accentBg} ${theme.textColor} rounded-full font-medium">
                    ${note.category || 'General'}
                  </span>
                  <span>${note.fileExtension?.toUpperCase() || 'FILE'}</span>
                </div>
              </div>
              <div class="text-2xl">📄</div>
            </div>
            
            <div class="flex items-center justify-between text-sm text-gray-500 mb-4">
              <span>By ${note.uploaderName}</span>
              <span>${note.createdAt ? new Date(note.createdAt.seconds * 1000).toLocaleDateString() : 'Recently'}</span>
            </div>
            
            <div class="flex gap-2">
              <button onclick="downloadNote('${note.id}')" 
                      class="flex-1 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white py-2 px-4 rounded-lg ${theme.hoverFrom} ${theme.hoverTo} transition-all duration-200 text-sm font-semibold flex items-center justify-center gap-2">
                <span>📥</span> Download
              </button>
              ${hasPermission('canDeleteNotes') && note.uploaderId === currentUser.uid ? `
                <button onclick="deleteNote('${note.id}')" 
                        class="bg-red-100 text-red-600 px-3 py-2 rounded-lg hover:bg-red-200 transition-all duration-200 text-sm">
                  🗑️
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  async loadPollsData(wrapper) {
    try {
      const pollsQuery = query(collection(db, 'polls'), orderBy('createdAt', 'desc'), limit(10));
      const snapshot = await getDocs(pollsQuery);
      
      const pollsContainer = wrapper.querySelector('#pollsContainer');
      if (!pollsContainer) return;
      
      const polls = [];
      snapshot.forEach(doc => {
        polls.push({ id: doc.id, ...doc.data() });
      });
      
      this.renderPolls(pollsContainer, polls);
    } catch (error) {
      console.error('Error loading polls:', error);
    }
  }

  renderPolls(container, polls) {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    
    if (polls.length === 0) {
      container.innerHTML = `
        <div class="text-center py-12 ${theme.bgLight} rounded-xl">
          <div class="text-6xl mb-4">📊</div>
          <h3 class="text-xl font-bold ${theme.textColor} mb-2">No Active Polls</h3>
          <p class="text-gray-500">No polls are currently available for voting.</p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = polls.map(poll => {
      const totalVotes = poll.options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
      const hasVoted = poll.options.some(opt => opt.voters?.includes(currentUser.uid));
      
      return `
        <div class="bg-white border-2 ${theme.borderColor} rounded-xl p-6 mb-6 hover:shadow-lg transition-all duration-200">
          <div class="flex items-start justify-between mb-4">
            <div class="flex-1">
              <h3 class="font-bold text-xl text-gray-800 mb-2">${poll.question}</h3>
              <div class="flex items-center gap-4 text-sm text-gray-500">
                <span>By ${poll.creatorName}</span>
                <span>${poll.createdAt ? new Date(poll.createdAt.seconds * 1000).toLocaleDateString() : 'Recently'}</span>
                <span class="px-2 py-1 ${theme.accentBg} ${theme.textColor} rounded-full font-medium">
                  ${totalVotes} votes
                </span>
              </div>
            </div>
            <div class="text-3xl">📊</div>
          </div>
          
          <div class="space-y-3">
            ${poll.options.map((option, index) => {
              const percentage = totalVotes > 0 ? Math.round((option.votes || 0) / totalVotes * 100) : 0;
              const isVoted = option.voters?.includes(currentUser.uid);
              
              return `
                <div class="relative">
                  <button onclick="voteOnPoll('${poll.id}', ${index})" 
                          class="w-full text-left p-4 border-2 rounded-lg transition-all duration-200 ${
                            hasVoted ? 'cursor-not-allowed opacity-75' : `hover:border-${theme.primaryColor}-300 cursor-pointer`
                          } ${isVoted ? `border-${theme.primaryColor}-500 bg-${theme.primaryColor}-50` : 'border-gray-200'}"
                          ${hasVoted ? 'disabled' : ''}>
                    
                    <div class="flex items-center justify-between">
                      <span class="font-medium text-gray-800">${option.text}</span>
                      <div class="flex items-center gap-2">
                        <span class="text-sm font-bold ${theme.textColor}">${percentage}%</span>
                        ${isVoted ? `<span class="text-lg">${theme.emoji}</span>` : ''}
                      </div>
                    </div>
                    
                    ${hasVoted ? `
                      <div class="mt-2 bg-gray-200 rounded-full h-2">
                        <div class="bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} h-2 rounded-full transition-all duration-500" 
                             style="width: ${percentage}%"></div>
                      </div>
                    ` : ''}
                  </button>
                </div>
              `;
            }).join('')}
          </div>
          
          ${hasVoted ? `
            <div class="mt-4 p-3 ${theme.bgLight} rounded-lg text-center">
              <span class="text-sm ${theme.textColor} font-medium">✅ You have voted in this poll</span>
            </div>
          ` : ''}
          
          ${hasPermission('canDeletePolls') && poll.creatorId === currentUser.uid ? `
            <div class="mt-4 pt-4 border-t border-gray-200">
              <button onclick="deletePoll('${poll.id}')" 
                      class="bg-red-100 text-red-600 px-4 py-2 rounded-lg hover:bg-red-200 transition-all duration-200 text-sm font-semibold">
                🗑️ Delete Poll
              </button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  async initializeChatSystem(wrapper) {
    const chatContainer = wrapper.querySelector('#chatContainer');
    const chatInput = wrapper.querySelector('#chatInput');
    const sendButton = wrapper.querySelector('#sendChatButton');
    
    if (!chatContainer || !chatInput || !sendButton) return;
    
    // Real-time chat listener
    const chatQuery = query(collection(db, 'chats'), orderBy('timestamp', 'asc'), limit(50));
    const unsubscribe = onSnapshot(chatQuery, (snapshot) => {
      this.renderChatMessages(chatContainer, snapshot);
    });
    
    realTimeListeners.set('chat', unsubscribe);
    
    // Send message functionality
    const sendMessage = async () => {
      const message = chatInput.value.trim();
      if (!message) return;
      
      try {
        await addDoc(collection(db, 'chats'), {
          message,
          userId: currentUser.uid,
          userName: currentUserData?.displayName || currentUser.email.split('@')[0],
          userRole: currentUserData?.role || 'student',
          timestamp: serverTimestamp()
        });
        
        chatInput.value = '';
      } catch (error) {
        console.error('Error sending message:', error);
        showMessage('❌ Failed to send message', 'error');
      }
    };
    
    sendButton.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  renderChatMessages(container, snapshot) {
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    const messages = [];
    
    snapshot.forEach(doc => {
      messages.push({ id: doc.id, ...doc.data() });
    });
    
    container.innerHTML = messages.map(msg => {
      const isOwnMessage = msg.userId === currentUser.uid;
      const userTheme = ROLE_THEMES[msg.userRole] || ROLE_THEMES.student;
      const timeAgo = msg.timestamp ? getTimeAgo(new Date(msg.timestamp.seconds * 1000)) : 'Just now';
      
      return `
        <div class="flex ${isOwnMessage ? 'justify-end' : 'justify-start'} mb-4">
          <div class="max-w-xs lg:max-w-md">
            <div class="flex items-center gap-2 mb-1 ${isOwnMessage ? 'flex-row-reverse' : ''}">
              <div class="w-6 h-6 bg-gradient-to-r ${userTheme.gradientFrom} ${userTheme.gradientTo} rounded-full flex items-center justify-center text-white text-xs">
                ${userTheme.emoji}
              </div>
              <span class="text-xs text-gray-500">${msg.userName}</span>
              <span class="text-xs text-gray-400">${timeAgo}</span>
            </div>
            <div class="p-3 rounded-2xl ${
              isOwnMessage 
                ? `bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white` 
                : 'bg-gray-100 text-gray-800'
            } shadow-sm">
              ${msg.message}
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }
}

// User Dropdown Management
function setupUserDropdown() {
  const userDropdown = document.getElementById('userDropdown');
  if (!userDropdown) return;
  
  // Toggle dropdown visibility
  userDropdown.addEventListener('click', (e) => {
    e.stopPropagation();
    const dropdown = document.getElementById('userDropdownMenu');
    if (dropdown) {
      dropdown.classList.toggle('hidden');
    }
  });
  
  // Close dropdown when clicking outside
  document.addEventListener('click', () => {
    const dropdown = document.getElementById('userDropdownMenu');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      dropdown.classList.add('hidden');
    }
  });
}

// Enhanced utility functions
function showMessage(message, type = 'success', duration = 4000) {
  console.log(`📢 ${type.toUpperCase()}: ${message}`);
  
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  
  const notification = document.createElement('div');
  
  const getNotificationStyle = (type) => {
    const styles = {
      success: `bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo}`,
      error: 'bg-gradient-to-r from-red-500 to-red-600',
      warning: 'bg-gradient-to-r from-yellow-500 to-orange-500',
      info: 'bg-gradient-to-r from-blue-500 to-indigo-500'
    };
    return styles[type] || styles.success;
  };
  
  const getNotificationIcon = (type) => {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    return icons[type] || icons.success;
  };
  
  notification.className = `fixed top-6 right-6 z-50 px-6 py-4 rounded-xl shadow-2xl flex items-center gap-3 text-white font-medium max-w-sm transform transition-all duration-500 ${getNotificationStyle(type)} backdrop-blur-sm`;
  notification.style.transform = 'translateX(100%)';
  
  notification.innerHTML = `
    <div class="flex-shrink-0 text-xl">${getNotificationIcon(type)}</div>
    <div class="flex-1 text-sm leading-relaxed">${message}</div>
    <button onclick="this.parentElement.remove()" 
            class="flex-shrink-0 text-white hover:text-gray-200 transition-colors text-lg font-bold ml-2 p-1 rounded hover:bg-white hover:bg-opacity-20">
      ×
    </button>
  `;
  
  document.body.appendChild(notification);
  
  setTimeout(() => notification.style.transform = 'translateX(0)', 100);
  
  setTimeout(() => {
    notification.style.transform = 'translateX(100%)';
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

// Enhanced dashboard content with role-based customization
function showDashboardContent() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;
  
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  const roleConfig = getDashboardConfig(currentUserData?.role);
  
  mainContent.innerHTML = `
    <div class="mb-8">
      <div class="flex items-center gap-4 mb-6 p-6 ${theme.lightPattern} rounded-2xl border-2 ${theme.borderColor}">
        <div class="w-16 h-16 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} rounded-full flex items-center justify-center text-white text-3xl shadow-lg">
          ${theme.emoji}
        </div>
        <div>
          <h1 class="text-4xl font-bold text-gray-800 mb-2">${roleConfig.title}</h1>
          <p class="text-gray-600 text-lg">${roleConfig.subtitle}</p>
          <div class="flex items-center gap-4 mt-2 text-sm text-gray-500">
            <span>👋 Welcome back, ${currentUserData?.displayName || 'User'}</span>
            <span>📅 ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
        </div>
      </div>
    </div>
    
    <!-- Enhanced Stats Grid -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      ${roleConfig.stats.map(stat => `
        <div class="bg-white p-6 rounded-xl shadow-sm border-2 ${theme.borderColor} hover:shadow-lg transition-all duration-200 transform hover:scale-105 hover:border-${theme.primaryColor}-300">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-600 text-sm font-medium">${stat.label}</p>
              <p class="text-3xl font-bold ${theme.textColor} mt-1" id="${stat.id}">0</p>
              <p class="text-xs text-gray-500 mt-1">${stat.description}</p>
            </div>
            <div class="${theme.accentBg} p-4 rounded-xl">
              <span class="${theme.textColor} text-2xl">${stat.icon}</span>
            </div>
          </div>
          <div class="mt-4 pt-4 border-t border-gray-100">
            <span class="text-xs text-green-600 font-medium">↗️ ${stat.trend || '+0%'} from last week</span>
          </div>
        </div>
      `).join('')}
    </div>
    
    <!-- Enhanced Quick Actions -->
    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
      ${roleConfig.quickActions.map(action => `
        <button onclick="${action.onclick}" 
                class="bg-gradient-to-br ${action.gradient} text-white p-8 rounded-2xl hover:shadow-xl transition-all duration-200 text-left group transform hover:scale-105 ${action.size || ''}">
          <div class="text-4xl mb-4 group-hover:scale-110 transition-transform duration-200">${action.icon}</div>
          <h3 class="text-xl font-bold mb-3">${action.title}</h3>
          <p class="text-white text-opacity-90 text-sm leading-relaxed mb-4">${action.description}</p>
          <div class="flex items-center justify-between">
            <span class="text-sm font-medium opacity-75">${action.subtitle}</span>
            <span class="text-2xl opacity-75 group-hover:opacity-100 transition-opacity">→</span>
          </div>
        </button>
      `).join('')}
    </div>
    
    <!-- Enhanced Activity Feed -->
    <div class="bg-white rounded-2xl shadow-sm border-2 ${theme.borderColor} p-8">
      <h2 class="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-3">
        <span class="text-3xl">${theme.emoji}</span>
        Recent Activity
        <span class="ml-auto text-sm font-normal text-gray-500">${roleConfig.activityTitle}</span>
      </h2>
      <div id="recentActivity" class="space-y-4">
        <div class="text-center py-12 text-gray-500">
          <div class="text-6xl mb-4">🔄</div>
          <p class="text-lg">Loading recent activity...</p>
        </div>
      </div>
    </div>
  `;
  
  loadEnhancedDashboardStats();
  loadEnhancedRecentActivity();
}

// Role-based dashboard configuration
function getDashboardConfig(role) {
  const configs = {
    student: {
      title: 'Student Dashboard',
      subtitle: 'Your academic journey at a glance',
      activityTitle: 'Your Learning Activity',
      stats: [
        { id: 'totalNotes', label: 'Notes Downloaded', icon: '📚', description: 'Study materials accessed', trend: '+12%' },
        { id: 'pollsVoted', label: 'Polls Participated', icon: '🗳️', description: 'Voice heard in polls', trend: '+8%' },
        { id: 'classesAttended', label: 'Classes Today', icon: '📅', description: 'Schedule adherence', trend: '+5%' },
        { id: 'chatMessages', label: 'Messages Sent', icon: '💬', description: 'Community engagement', trend: '+15%' }
      ],
      quickActions: [
        {
          title: 'Study Materials',
          description: 'Access notes, assignments, and study guides shared by faculty',
          icon: '📖',
          subtitle: 'Download & Learn',
          gradient: 'from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700',
          onclick: "modalManager.openModal('notesModal')"
        },
        {
          title: 'Class Schedule',
          description: 'Check your timetable and upcoming classes',
          icon: '🕐',
          subtitle: 'Stay Organized',
          gradient: 'from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700',
          onclick: "modalManager.openModal('timetableModal')"
        },
        {
          title: 'Polls & Surveys',
          description: 'Participate in polls and share your opinion on campus topics',
          icon: '📊',
          subtitle: 'Voice Your Opinion',
          gradient: 'from-purple-500 to-violet-600 hover:from-purple-600 hover:to-violet-700',
          onclick: "modalManager.openModal('pollsModal')"
        }
      ]
    },
    faculty: {
      title: 'Faculty Dashboard',
      subtitle: 'Empower your teaching and engage with students',
      activityTitle: 'Teaching & Management Activity',
      stats: [
        { id: 'notesShared', label: 'Notes Shared', icon: '📝', description: 'Materials uploaded', trend: '+20%' },
        { id: 'pollsCreated', label: 'Polls Created', icon: '📊', description: 'Student engagement', trend: '+18%' },
        { id: 'studentsReached', label: 'Students Reached', icon: '👥', description: 'Your impact', trend: '+25%' },
        { id: 'classesManaged', label: 'Classes Managed', icon: '🎓', description: 'Academic oversight', trend: '+10%' }
      ],
      quickActions: [
        {
          title: 'Upload Content',
          description: 'Share notes, assignments, and learning materials with students',
          icon: '📤',
          subtitle: 'Share Knowledge',
          gradient: 'from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700',
          onclick: "modalManager.openModal('notesModal')"
        },
        {
          title: 'Create Polls',
          description: 'Gather student feedback and opinions on various topics',
          icon: '🗳️',
          subtitle: 'Engage Students',
          gradient: 'from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700',
          onclick: "modalManager.openModal('pollsModal')"
        },
        {
          title: 'Manage Schedule',
          description: 'Organize your classes and academic calendar',
          icon: '📋',
          subtitle: 'Stay Organized',
          gradient: 'from-blue-500 to-cyan-600 hover:from-blue-600 hover:to-cyan-700',
          onclick: "modalManager.openModal('timetableModal')"
        },
        {
          title: 'Analytics',
          description: 'View detailed insights about student engagement and performance',
          icon: '📈',
          subtitle: 'Track Progress',
          gradient: 'from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600',
          onclick: "showAnalyticsContent()",
          size: 'md:col-span-2 lg:col-span-1'
        }
      ]
    },
    admin: {
      title: 'Administrator Dashboard',
      subtitle: 'Complete platform oversight and management',
      activityTitle: 'System Management Activity',
      stats: [
        { id: 'totalUsers', label: 'Total Users', icon: '👥', description: 'Platform members', trend: '+30%' },
        { id: 'systemHealth', label: 'System Health', icon: '💚', description: 'Platform status', trend: '99.9%' },
        { id: 'contentItems', label: 'Content Items', icon: '📊', description: 'Total resources', trend: '+45%' },
        { id: 'dailyActive', label: 'Daily Active', icon: '🔥', description: 'Engaged users', trend: '+22%' }
      ],
      quickActions: [
        {
          title: 'User Management',
          description: 'Manage user accounts, roles, and permissions across the platform',
          icon: '👨‍💼',
          subtitle: 'Control Access',
          gradient: 'from-red-500 to-pink-600 hover:from-red-600 hover:to-pink-700',
          onclick: "showUsersContent()"
        },
        {
          title: 'Content Oversight',
          description: 'Monitor and moderate all content including notes, polls, and discussions',
          icon: '🔍',
          subtitle: 'Quality Control',
          gradient: 'from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700',
          onclick: "modalManager.openModal('notesModal')"
        },
        {
          title: 'System Analytics',
          description: 'Comprehensive platform analytics and performance metrics',
          icon: '📊',
          subtitle: 'Deep Insights',
          gradient: 'from-cyan-500 to-blue-600 hover:from-cyan-600 hover:to-blue-700',
          onclick: "showAnalyticsContent()"
        },
        {
          title: 'Platform Settings',
          description: 'Configure system-wide settings and platform preferences',
          icon: '⚙️',
          subtitle: 'System Config',
          gradient: 'from-gray-600 to-gray-700 hover:from-gray-700 hover:to-gray-800',
          onclick: "showSettingsContent()"
        }
      ]
    }
  };
  
  return configs[role] || configs.student;
}

// Enhanced statistics loading
async function loadEnhancedDashboardStats() {
  try {
    const role = currentUserData?.role || 'student';
    
    if (role === 'student') {
      await loadStudentStats();
    } else if (role === 'faculty') {
      await loadFacultyStats();
    } else if (role === 'admin') {
      await loadAdminStats();
    }
  } catch (error) {
    console.error('Error loading dashboard stats:', error);
  }
}

async function loadStudentStats() {
  try {
    const notesQuery = query(
      collection(db, 'noteDownloads'), 
      where('userId', '==', currentUser.uid)
    );
    const notesSnapshot = await getDocs(notesQuery);
    updateStatElement('totalNotes', notesSnapshot.size);
    
    const pollsQuery = query(collection(db, 'polls'));
    const pollsSnapshot = await getDocs(pollsQuery);
    let pollsVoted = 0;
    pollsSnapshot.forEach(doc => {
      const data = doc.data();
      if (data.options.some(option => option.voters && option.voters.includes(currentUser.uid))) {
        pollsVoted++;
      }
    });
    updateStatElement('pollsVoted', pollsVoted);
    
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const timetableQuery = query(
      collection(db, 'timetable'),
      where('day', '==', today)
    );
    const timetableSnapshot = await getDocs(timetableQuery);
    updateStatElement('classesAttended', timetableSnapshot.size);
    
    const chatQuery = query(
      collection(db, 'chats'),
      where('userId', '==', currentUser.uid)
    );
    const chatSnapshot = await getDocs(chatQuery);
    updateStatElement('chatMessages', chatSnapshot.size);
    
  } catch (error) {
    console.error('Error loading student stats:', error);
  }
}

async function loadFacultyStats() {
  try {
    const notesQuery = query(
      collection(db, 'notes'),
      where('uploaderId', '==', currentUser.uid)
    );
    const notesSnapshot = await getDocs(notesQuery);
    updateStatElement('notesShared', notesSnapshot.size);
    
    const pollsQuery = query(
      collection(db, 'polls'),
      where('creatorId', '==', currentUser.uid)
    );
    const pollsSnapshot = await getDocs(pollsQuery);
    updateStatElement('pollsCreated', pollsSnapshot.size);
    
    let studentsReached = new Set();
    pollsSnapshot.forEach(doc => {
      const data = doc.data();
      data.options.forEach(option => {
        if (option.voters) {
          option.voters.forEach(voterId => studentsReached.add(voterId));
        }
      });
    });
    
    updateStatElement('studentsReached', studentsReached.size);
    
    const timetableQuery = query(
      collection(db, 'timetable'),
      where('userId', '==', currentUser.uid)
    );
    const timetableSnapshot = await getDocs(timetableQuery);
    updateStatElement('classesManaged', timetableSnapshot.size);
    
  } catch (error) {
    console.error('Error loading faculty stats:', error);
  }
}

async function loadAdminStats() {
  try {
    const usersSnapshot = await getDocs(collection(db, 'users'));
    updateStatElement('totalUsers', usersSnapshot.size);
    
    updateStatElement('systemHealth', '99.9');
    
    const [notesSnap, pollsSnap, timetableSnap, chatsSnap] = await Promise.all([
      getDocs(collection(db, 'notes')),
      getDocs(collection(db, 'polls')),
      getDocs(collection(db, 'timetable')),
      getDocs(collection(db, 'chats'))
    ]);
    
    const totalContent = notesSnap.size + pollsSnap.size + timetableSnap.size + chatsSnap.size;
    updateStatElement('contentItems', totalContent);
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let dailyActive = 0;
    usersSnapshot.forEach(doc => {
      const userData = doc.data();
      if (userData.lastLogin && userData.lastLogin.toDate() >= today) {
        dailyActive++;
      }
    });
    
    updateStatElement('dailyActive', dailyActive);
    
  } catch (error) {
    console.error('Error loading admin stats:', error);
  }
}

function updateStatElement(elementId, value) {
  const element = document.getElementById(elementId);
  if (element) {
    const startValue = parseInt(element.textContent) || 0;
    const endValue = parseInt(value) || 0;
    const duration = 1000;
    const increment = (endValue - startValue) / (duration / 16);
    
    let currentValue = startValue;
    const counter = setInterval(() => {
      currentValue += increment;
      if (currentValue >= endValue) {
        element.textContent = endValue;
        clearInterval(counter);
      } else {
        element.textContent = Math.floor(currentValue);
      }
    }, 16);
  }
}

// Enhanced recent activity loading
async function loadEnhancedRecentActivity() {
  const recentActivityEl = document.getElementById('recentActivity');
  if (!recentActivityEl) return;
  
  try {
    const activities = [];
    const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
    const role = currentUserData?.role || 'student';
    
    if (hasPermission('canViewNotes')) {
      const notesQuery = query(collection(db, 'notes'), orderBy('createdAt', 'desc'), limit(5));
      const notesSnapshot = await getDocs(notesQuery);
      notesSnapshot.docs.forEach(doc => {
        const data = doc.data();
        activities.push({
          type: 'note',
          title: `📝 ${data.uploaderName} shared "${data.title}"`,
          subtitle: `${data.category} • ${data.fileExtension?.toUpperCase()}`,
          time: data.createdAt,
          icon: '📝',
          color: theme.textColor,
          priority: role === 'student' ? 3 : 2
        });
      });
    }
    
    if (hasPermission('canVotePolls')) {
      const pollsQuery = query(collection(db, 'polls'), orderBy('createdAt', 'desc'), limit(5));
      const pollsSnapshot = await getDocs(pollsQuery);
      pollsSnapshot.docs.forEach(doc => {
        const data = doc.data();
        const totalVotes = data.options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
        activities.push({
          type: 'poll',
          title: `📊 ${data.creatorName} created "${data.question}"`,
          subtitle: `${totalVotes} votes • ${data.options.length} options`,
          time: data.createdAt,
          icon: '📊',
          color: theme.textColor,
          priority: 2
        });
      });
    }
    
    activities.sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority;
      if (!a.time || !b.time) return 0;
      return b.time.seconds - a.time.seconds;
    });
    
    if (activities.length === 0) {
      recentActivityEl.innerHTML = `
        <div class="text-center py-12 ${theme.bgLight} rounded-xl border-2 border-dashed ${theme.borderColor}">
          <div class="text-6xl mb-4">${theme.emoji}</div>
          <h3 class="text-xl font-semibold ${theme.textColor} mb-2">No Recent Activity</h3>
          <p class="text-gray-500">Start using the platform to see activity here!</p>
        </div>
      `;
      return;
    }
    
    recentActivityEl.innerHTML = activities.slice(0, 10).map(activity => {
      const timeAgo = activity.time ? 
        getTimeAgo(new Date(activity.time.seconds * 1000)) : 
        'Just now';
      
      return `
        <div class="flex items-start gap-4 p-6 border-2 ${theme.borderColor} rounded-xl ${theme.bgLight} hover:${theme.bgMedium} hover:shadow-md transition-all duration-200 transform hover:scale-102 cursor-pointer group">
          <div class="flex-shrink-0 w-12 h-12 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} rounded-full flex items-center justify-center text-white text-xl shadow-lg group-hover:scale-110 transition-transform duration-200">
            ${activity.icon}
          </div>
          <div class="flex-1 min-w-0">
            <h4 class="font-semibold text-gray-800 mb-1 group-hover:${theme.textColor} transition-colors duration-200">${activity.title}</h4>
            <p class="text-sm text-gray-600 mb-2">${activity.subtitle}</p>
            <div class="flex items-center gap-4 text-xs text-gray-500">
              <span class="flex items-center gap-1">
                <span>⏰</span>
                <span>${timeAgo}</span>
              </span>
              <span class="px-2 py-1 ${theme.accentBg} ${theme.textColor} rounded-full font-medium capitalize">
                ${activity.type}
              </span>
            </div>
          </div>
          <div class="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span class="text-2xl ${theme.textColor}">→</span>
          </div>
        </div>
      `;
    }).join('');
    
  } catch (error) {
    console.error('Error loading recent activity:', error);
    recentActivityEl.innerHTML = `
      <div class="text-center py-8 text-red-500">
        <div class="text-4xl mb-2">❌</div>
        <p>Failed to load recent activity</p>
      </div>
    `;
  }
}

function getTimeAgo(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);
  
  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
  return date.toLocaleDateString();
}

function getCurrentSemester() {
  const month = new Date().getMonth() + 1;
  if (month >= 1 && month <= 5) return 'Spring';
  if (month >= 6 && month <= 8) return 'Summer';
  return 'Fall';
}

function getCurrentAcademicYear() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  
  if (month >= 8) {
    return `${year}-${year + 1}`;
  } else {
    return `${year - 1}-${year}`;
  }
}

// Enhanced user UI updates
function updateUserUI() {
  const userNameEl = document.getElementById('userName');
  const userEmailEl = document.getElementById('userEmail');
  const userRoleEl = document.getElementById('userRole');
  const roleBadgeEl = document.getElementById('roleBadge');
  const userAvatarEl = document.getElementById('userAvatar');
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  
  if (userNameEl) {
    userNameEl.textContent = currentUserData?.displayName || currentUser?.email?.split('@')[0] || 'User';
  }
  if (userEmailEl) {
    userEmailEl.textContent = currentUser?.email || '';
  }
  if (userRoleEl) {
    userRoleEl.textContent = currentUserData?.role || 'student';
  }
  if (roleBadgeEl) {
    roleBadgeEl.innerHTML = `
      <span class="flex items-center gap-2 px-4 py-2 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} text-white rounded-full text-sm font-semibold shadow-lg">
        <span class="text-lg">${theme.emoji}</span>
        <span>${theme.name}</span>
      </span>
    `;
  }
  if (userAvatarEl) {
    userAvatarEl.innerHTML = `
      <div class="w-10 h-10 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} rounded-full flex items-center justify-center text-white font-semibold text-lg shadow-lg">
        ${theme.emoji}
      </div>
    `;
  }
  
  // Update user dropdown menu
  updateUserDropdownMenu();
  
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.className = `fixed left-0 top-0 h-full w-64 bg-white shadow-xl transform transition-transform duration-300 ease-in-out z-40 border-r-4 ${theme.borderColor} md:relative md:translate-x-0`;
  }
  
  document.title = `CollegeConnect - ${theme.name} Dashboard`;
}

// Update user dropdown menu with profile options
function updateUserDropdownMenu() {
  const userDropdownMenu = document.getElementById('userDropdownMenu');
  if (!userDropdownMenu) return;
  
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  const displayName = currentUserData?.displayName || currentUser?.email?.split('@')[0] || 'User';
  
  userDropdownMenu.innerHTML = `
    <div class="py-2">
      <!-- User Info Header -->
      <div class="px-4 py-3 border-b border-gray-100">
        <div class="flex items-center gap-3">
          <div class="w-12 h-12 bg-gradient-to-r ${theme.gradientFrom} ${theme.gradientTo} rounded-full flex items-center justify-center text-white text-xl">
            ${theme.emoji}
          </div>
          <div>
            <div class="font-semibold text-gray-800">${displayName}</div>
            <div class="text-sm text-gray-500">${currentUser?.email || ''}</div>
            <div class="text-xs ${theme.textColor} font-medium capitalize">${currentUserData?.role || 'student'}</div>
          </div>
        </div>
      </div>
      
      <!-- Menu Items -->
      <div class="py-2">
        <button onclick="UserProfileManager.showUserProfile(); document.getElementById('userDropdownMenu').classList.add('hidden')" 
                class="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors duration-200 flex items-center gap-3">
          <span class="text-lg">👤</span>
          <span>My Profile</span>
        </button>
        
        <button onclick="UserProfileManager.showChangePasswordModal(); document.getElementById('userDropdownMenu').classList.add('hidden')" 
                class="w-full text-left px-4 py-3 text-gray-700 hover:bg-gray-100 transition-colors duration-200 flex items-center gap-3">
          <span class="text-lg">🔐</span>
          <span>Change Password</span>
        </button>
        
        <div class="border-t border-gray-100 my-2"></div>
        
        <button onclick="UserProfileManager.confirmLogout(); document.getElementById('userDropdownMenu').classList.add('hidden')" 
                class="w-full text-left px-4 py-3 text-red-600 hover:bg-red-50 transition-colors duration-200 flex items-center gap-3">
          <span class="text-lg">🚪</span>
          <span>Logout</span>
        </button>
      </div>
    </div>
  `;
}

// Content management functions
async function downloadNote(noteId) {
  try {
    const noteRef = doc(db, 'notes', noteId);
    const noteDoc = await getDoc(noteRef);
    
    if (!noteDoc.exists()) {
      showMessage('❌ Note not found', 'error');
      return;
    }
    
    const noteData = noteDoc.data();
    
    // Record download
    await addDoc(collection(db, 'noteDownloads'), {
      noteId,
      userId: currentUser.uid,
      userName: currentUserData?.displayName || currentUser.email.split('@')[0],
      downloadedAt: serverTimestamp()
    });
    
    // Simulate download (in real app, would use actual file URL)
    const link = document.createElement('a');
    link.href = noteData.fileUrl || '#';
    link.download = noteData.fileName || 'download';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showMessage(`✅ Downloaded: ${noteData.title}`, 'success');
  } catch (error) {
    console.error('Error downloading note:', error);
    showMessage('❌ Failed to download note', 'error');
  }
}

async function deleteNote(noteId) {
  if (!confirm('Are you sure you want to delete this note?')) return;
  
  try {
    await deleteDoc(doc(db, 'notes', noteId));
    showMessage('✅ Note deleted successfully', 'success');
    
    // Refresh notes modal if open
    const notesModal = document.getElementById('rendered-notesModal');
    if (notesModal) {
      modalManager.closeModal('notesModal');
      modalManager.openModal('notesModal');
    }
  } catch (error) {
    console.error('Error deleting note:', error);
    showMessage('❌ Failed to delete note', 'error');
  }
}

async function voteOnPoll(pollId, optionIndex) {
  try {
    const pollRef = doc(db, 'polls', pollId);
    const pollDoc = await getDoc(pollRef);
    
    if (!pollDoc.exists()) {
      showMessage('❌ Poll not found', 'error');
      return;
    }
    
    const pollData = pollDoc.data();
    const hasVoted = pollData.options.some(opt => opt.voters?.includes(currentUser.uid));
    
    if (hasVoted) {
      showMessage('❌ You have already voted in this poll', 'error');
      return;
    }
    
    await runTransaction(db, async (transaction) => {
      const updatedOptions = [...pollData.options];
      updatedOptions[optionIndex].votes = (updatedOptions[optionIndex].votes || 0) + 1;
      updatedOptions[optionIndex].voters = updatedOptions[optionIndex].voters || [];
      updatedOptions[optionIndex].voters.push(currentUser.uid);
      
      transaction.update(pollRef, { options: updatedOptions });
    });
    
    showMessage('✅ Vote recorded successfully!', 'success');
    
    // Refresh polls modal if open
    const pollsModal = document.getElementById('rendered-pollsModal');
    if (pollsModal) {
      modalManager.closeModal('pollsModal');
      modalManager.openModal('pollsModal');
    }
  } catch (error) {
    console.error('Error voting on poll:', error);
    showMessage('❌ Failed to record vote', 'error');
  }
}

async function deletePoll(pollId) {
  if (!confirm('Are you sure you want to delete this poll?')) return;
  
  try {
    await deleteDoc(doc(db, 'polls', pollId));
    showMessage('✅ Poll deleted successfully', 'success');
    
    // Refresh polls modal if open
    const pollsModal = document.getElementById('rendered-pollsModal');
    if (pollsModal) {
      modalManager.closeModal('pollsModal');
      modalManager.openModal('pollsModal');
    }
  } catch (error) {
    console.error('Error deleting poll:', error);
    showMessage('❌ Failed to delete poll', 'error');
  }
}

// Admin content functions
function showUsersContent() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;
  
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  
  mainContent.innerHTML = `
    <div class="mb-8">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">User Management</h1>
          <p class="text-gray-600">Manage user accounts, roles, and permissions</p>
        </div>
        <button onclick="showDashboardContent()" 
                class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors duration-200 flex items-center gap-2">
          <span>←</span> Back to Dashboard
        </button>
      </div>
    </div>
    
    <div class="bg-white rounded-2xl shadow-sm border-2 ${theme.borderColor} p-8">
      <div class="text-center py-12">
        <div class="text-6xl mb-4">👥</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">User Management</h3>
        <p class="text-gray-500 mb-4">Advanced user management features coming soon</p>
        <div class="text-sm text-gray-400">This section will include user listing, role management, and access controls</div>
      </div>
    </div>
  `;
}

function showAnalyticsContent() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;
  
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  
  mainContent.innerHTML = `
    <div class="mb-8">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">Analytics Dashboard</h1>
          <p class="text-gray-600">Comprehensive insights and performance metrics</p>
        </div>
        <button onclick="showDashboardContent()" 
                class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors duration-200 flex items-center gap-2">
          <span>←</span> Back to Dashboard
        </button>
      </div>
    </div>
    
    <div class="bg-white rounded-2xl shadow-sm border-2 ${theme.borderColor} p-8">
      <div class="text-center py-12">
        <div class="text-6xl mb-4">📊</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">Advanced Analytics</h3>
        <p class="text-gray-500 mb-4">Detailed analytics and reporting features coming soon</p>
        <div class="text-sm text-gray-400">This section will include charts, reports, and data visualizations</div>
      </div>
    </div>
  `;
}

function showSettingsContent() {
  const mainContent = document.getElementById('mainContent');
  if (!mainContent) return;
  
  const theme = ROLE_THEMES[currentUserData?.role] || ROLE_THEMES.student;
  
  mainContent.innerHTML = `
    <div class="mb-8">
      <div class="flex items-center justify-between mb-6">
        <div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">Platform Settings</h1>
          <p class="text-gray-600">Configure system-wide settings and preferences</p>
        </div>
        <button onclick="showDashboardContent()" 
                class="bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors duration-200 flex items-center gap-2">
          <span>←</span> Back to Dashboard
        </button>
      </div>
    </div>
    
    <div class="bg-white rounded-2xl shadow-sm border-2 ${theme.borderColor} p-8">
      <div class="text-center py-12">
        <div class="text-6xl mb-4">⚙️</div>
        <h3 class="text-xl font-bold text-gray-800 mb-2">System Configuration</h3>
        <p class="text-gray-500 mb-4">Platform settings and configuration options coming soon</p>
        <div class="text-sm text-gray-400">This section will include system preferences, security settings, and more</div>
      </div>
    </div>
  `;
}

// Initialize the dashboard system
let modalManager;

// Authentication state observer
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    
    try {
      const userDoc = await getDoc(doc(db, 'users', user.uid));
      if (userDoc.exists()) {
        currentUserData = userDoc.data();
        
        // Update last login
        await updateDoc(doc(db, 'users', user.uid), {
          lastLogin: serverTimestamp()
        });
        
        // Initialize UI
        updateUserUI();
        showDashboardContent();
        setupUserDropdown();
        
        // Initialize modal manager
        modalManager = new EnhancedDashboardModalManager();
        
        console.log('✅ Dashboard initialized successfully');
        showMessage(`👋 Welcome back, ${currentUserData.displayName || 'User'}!`, 'success');
      } else {
        console.error('❌ User document not found');
        showMessage('❌ User profile not found. Please contact support.', 'error');
      }
    } catch (error) {
      console.error('❌ Error loading user data:', error);
      showMessage('❌ Failed to load user data', 'error');
    }
  } else {
    console.log('👋 User not authenticated, redirecting to login');
    window.location.href = 'index.html';
  }
});

// Export functions for global access
window.modalManager = modalManager;
window.UserProfileManager = UserProfileManager;
window.downloadNote = downloadNote;
window.deleteNote = deleteNote;
window.voteOnPoll = voteOnPoll;
window.deletePoll = deletePoll;
window.showUsersContent = showUsersContent;
window.showAnalyticsContent = showAnalyticsContent;
window.showSettingsContent = showSettingsContent;
window.showDashboardContent = showDashboardContent;