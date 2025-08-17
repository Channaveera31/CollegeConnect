const authForm = document.getElementById('authForm');
console.log("Auth Form found:", authForm);
if (authForm) {
  authForm.addEventListener('submit', handleAuthSubmission);
}

import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updatePassword,
  reauthenticateWithCredential,
  EmailAuthProvider,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js';
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.1.0/firebase-firestore.js';

// --- UI Helpers ---
function showMessage(message, type = 'success', duration = 4000) {
  console.log(`📢 Message: ${message} (${type})`);
  const messageEl = document.getElementById(type + 'Message');
  const textEl = document.getElementById(type + 'Text');
  if (messageEl && textEl) {
    textEl.textContent = message;
    messageEl.classList.remove('hidden');
    messageEl.style.transform = 'translateX(100%)';
    messageEl.style.transition = 'transform 0.3s ease-in-out';
    setTimeout(() => {
      messageEl.style.transform = 'translateX(0)';
    }, 100);
    setTimeout(() => {
      messageEl.style.transform = 'translateX(100%)';
      setTimeout(() => messageEl.classList.add('hidden'), 300);
    }, duration);
  } else {
    alert(message);
  }
}

function setAuthLoading(loading = true) {
  const submitBtn = document.getElementById('authSubmit');
  const statusEl = document.getElementById('authStatus');
  if (submitBtn) {
    submitBtn.disabled = loading;
    submitBtn.innerHTML = loading
      ? '<span class="flex items-center gap-2"><div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Processing...</span>'
      : getCurrentMode() === 'register'
        ? '🚀 Create Account'
        : '🔑 Sign In';
  }
  if (statusEl) {
    statusEl.innerHTML = loading ? '⏳ Please wait...' : '';
  }
}

export function getCurrentMode() {
  const title = document.getElementById('authTitle');
  // Looks for 'create' in any case (for "📝 Create Your Account")
  return title && title.textContent.toLowerCase().includes('create') ? 'register' : 'login';
}

function updateAuthModalForMode(mode) {
  const title = document.getElementById('authTitle');
  const subtitle = document.getElementById('authSubtitle');
  const submitBtn = document.getElementById('authSubmit');
  const switchBtn = document.getElementById('authSwitch');
  const roleSection = document.getElementById('roleSection');
  const nameSection = document.getElementById('nameSection');
  const dobSection = document.getElementById('dobSection');
  const genderSection = document.getElementById('genderSection');
  const termsSection = document.getElementById('termsSection');
  const rememberSection = document.getElementById('rememberSection');
  const forgotSection = document.getElementById('forgotPasswordSection');

  const phoneSection = document.getElementById('phoneSection');
const collegeSection = document.getElementById('collegeSection');
const departmentSection = document.getElementById('departmentSection');
const yearSection = document.getElementById('yearSection');


if (mode === 'register') {
  if (title) title.innerHTML = '📝 Create Your Account';
  if (subtitle) subtitle.textContent = 'Join the CollegeConnect community today';
  if (submitBtn) submitBtn.innerHTML = '🚀 Create Account';
  if (switchBtn) switchBtn.innerHTML = '🔑 Already have an account? Sign In';

  // Show registration-only fields
  [roleSection, nameSection, dobSection, genderSection, phoneSection, collegeSection, departmentSection, yearSection, termsSection]
  .forEach(section => {
    if (section) section.classList.remove('hidden');
  });

  // Hide login-only fields
  [rememberSection, forgotSection].forEach(section => {
    if (section) section.classList.add('hidden');
  });

} else {
  if (title) title.innerHTML = '🔑 Welcome Back';
  if (subtitle) subtitle.textContent = 'Sign in to access your dashboard';
  if (submitBtn) submitBtn.innerHTML = '🔑 Sign In';
  if (switchBtn) switchBtn.innerHTML = '📝 New to CollegeConnect? Register';

  // Hide registration-only fields & remove `required`
  [roleSection, nameSection, dobSection, genderSection, phoneSection, collegeSection, departmentSection, yearSection, termsSection]
  .forEach(section => {
    if (section) section.classList.add('hidden');
  });

  // Show login-only fields
  [rememberSection, forgotSection].forEach(section => {
    if (section) section.classList.remove('hidden');
  });
}

  const modal = document.getElementById('authModal');
  if (modal) {
    modal.style.transition = 'all 0.3s ease-in-out';
  }

  // At the end of your function
setAuthLoading(false);

}

import { registerUser } from './auth-enhanced.js';

window.simulateRegistration = async function (formData) {
  try {
    // Extract fields from formData (matches getFormData output)
    const fullName = formData.name || '';
    const dob = formData.dob || '';
    const gender = formData.gender || '';
    const role = formData.role || '';
    const email = formData.email || '';
    const password = formData.password || '';
    const phone = formData.phone || '';
    const college = formData.college || '';
    const department = formData.department || '';
    const year = formData.year || '';

    // Create the user in Firebase Auth
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    const uid = cred.user.uid;

    // Save extra details to Firestore
    await setDoc(doc(db, 'users', uid), {
      fullName,
      email,
      dob,
      gender,
      role,
      phone,
      college,
      department,
      year,
      createdAt: serverTimestamp(),
      profileComplete: true
    });

    console.log('✅ Registration complete for:', fullName);
    showMessage(`🎉 Welcome ${fullName}! Your account has been created.`, 'success', 4000);

    // Redirect to dashboard
    setTimeout(() => {
      window.location.href = `dashboard.html?role=${role}`;
    }, 1500);

  } catch (err) {
    console.error('❌ Registration failed:', err);
    showMessage('❌ Failed to register: ' + err.message, 'error');
  }
};

export async function loginUser(email, password) {
  setAuthLoading(true);
  try {
    if (!email || !password) throw new Error('Please fill in all required fields');
    const cred = await signInWithEmailAndPassword(auth, email, password);
    // Get user data from Firestore
    let userData = null;
    const userDocRef = doc(db, 'users', cred.user.uid);
    const userDoc = await getDoc(userDocRef);
    if (userDoc.exists()) {
      userData = userDoc.data();
      await updateDoc(userDocRef, {
        lastLogin: serverTimestamp(),
        updatedAt: serverTimestamp(),
        'stats.lastActivity': serverTimestamp(),
        'stats.loginCount': (userData.stats?.loginCount || 0) + 1
      });
    } else {
      userData = {
        uid: cred.user.uid,
        email: cred.user.email.toLowerCase(),
        role: 'student',
        displayName: cred.user.displayName || cred.user.email.split('@')[0],
        createdAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        isActive: true,
        profileComplete: false,
        emailVerified: cred.user.emailVerified || false,
        preferences: { notifications: true, theme: 'student', language: 'en' },
        stats: { loginCount: 1, lastActivity: serverTimestamp() }
      };
      await setDoc(userDocRef, userData);
    }
    showMessage(`🎉 Welcome back ${userData.displayName || email.split('@')[0]}!`, 'success', 4000);
    setTimeout(() => {
      window.location.href = `dashboard.html?role=${userData.role}`;
    }, 2000);
    return { success: true, user: cred.user, userData };
  } catch (err) {
    let errorMessage = err.message;
    if (errorMessage.includes('user-not-found')) {
      errorMessage = '❌ No account found with this email. Please register first.';
    } else if (errorMessage.includes('wrong-password') || errorMessage.includes('invalid-credential')) {
      errorMessage = '🔒 Incorrect email or password. Please try again.';
    } else if (errorMessage.includes('invalid-email')) {
      errorMessage = '📧 Please enter a valid email address.';
    }
    showMessage(errorMessage, 'error', 6000);
    throw err;
  } finally {
    setAuthLoading(false);
  }
}

export async function logoutUser() {
  try {
    await signOut(auth);
    showMessage('👋 Signed out successfully! See you soon!', 'success', 3000);
    setTimeout(() => window.location.href = 'index.html', 2000);
  } catch (err) {
    showMessage('❌ Error signing out. Please try again.', 'error');
  }
}

export function checkPortalAccess() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      unsubscribe();
      if (user) {
        try {
          const userDocRef = doc(db, 'users', user.uid);
          const userDoc = await getDoc(userDocRef);
          let userData;
          if (userDoc.exists()) {
            userData = userDoc.data();
            if (userData.isActive === false) {
              resolve({ canAccess: false, user: null, userData: null, reason: 'Account is disabled' });
              return;
            }
          } else {
            userData = {
              uid: user.uid,
              email: user.email,
              role: 'student',
              displayName: user.displayName || user.email.split('@')[0],
              isActive: true,
              profileComplete: false,
              createdAt: serverTimestamp()
            };
            await setDoc(userDocRef, userData);
          }
          resolve({ canAccess: true, user, userData, isFirstTime: !userData.profileComplete });
        } catch (error) {
          resolve({ canAccess: true, user, userData: { role: 'student', displayName: user.displayName || user.email.split('@')[0], isActive: true }, hasError: true });
        }
      } else {
        resolve({ canAccess: false, user: null, userData: null, reason: 'Not authenticated' });
      }
    });
  });
}

export async function changeUserPassword(currentPassword, newPassword) {
  if (!auth.currentUser) {
    throw new Error('No user is currently signed in');
  }
  if (!currentPassword || !newPassword) {
    throw new Error('Please provide both current and new passwords');
  }
  if (newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long');
  }
  if (currentPassword === newPassword) {
    throw new Error('New password must be different from current password');
  }
  try {
    console.log('🔐 Attempting password change...');
    const credential = EmailAuthProvider.credential(
      auth.currentUser.email,
      currentPassword
    );
    await reauthenticateWithCredential(auth.currentUser, credential);
    console.log('✅ User re-authenticated successfully');
    await updatePassword(auth.currentUser, newPassword);
    console.log('✅ Password updated successfully');
    await updateDoc(doc(db, 'users', auth.currentUser.uid), {
      updatedAt: serverTimestamp(),
      clientUpdatedAt: new Date().toISOString(),
      'stats.lastPasswordChange': serverTimestamp(),
      'stats.clientLastPasswordChange': new Date().toISOString()
    });
    showMessage('🔐 Password changed successfully!', 'success');
    return true;
  } catch (error) {
    console.error('❌ Password change error:', error);
    let errorMessage = error.message;
    if (errorMessage.includes('wrong-password')) {
      errorMessage = '❌ Current password is incorrect';
    } else if (errorMessage.includes('weak-password')) {
      errorMessage = '🔒 New password is too weak. Please use at least 6 characters with numbers and symbols.';
    } else if (errorMessage.includes('requires-recent-login')) {
      errorMessage = '🔐 Please sign out and sign in again before changing your password';
    } else if (!errorMessage.includes('❌')) {
      errorMessage = `❌ Failed to change password: ${errorMessage}`;
    }
    showMessage(errorMessage, 'error');
    throw error;
  }
}

export async function updateUserProfile(profileData) {
  if (!auth.currentUser) {
    throw new Error('No user is currently signed in');
  }
  try {
    console.log('👤 Updating user profile...', profileData);
    const updateData = {
      ...profileData,
      updatedAt: serverTimestamp(),
      clientUpdatedAt: new Date().toISOString()
    };
    Object.keys(updateData).forEach(key => {
      if (updateData[key] === '' || updateData[key] === undefined) {
        delete updateData[key];
      }
    });
    await updateDoc(doc(db, 'users', auth.currentUser.uid), updateData);
    console.log('✅ Profile updated successfully');
    showMessage('✅ Profile updated successfully!', 'success');
    return true;
  } catch (error) {
    console.error('❌ Profile update error:', error);
    showMessage('❌ Failed to update profile: ' + error.message, 'error');
    throw error;
  }
}

export async function resetPassword(email) {
  if (!email) {
    throw new Error('Please provide an email address');
  }
  if (!validateEmail(email)) {
    throw new Error('Please enter a valid email address');
  }
  try {
    console.log('📧 Sending password reset email...');
    await sendPasswordResetEmail(auth, email);
    console.log('✅ Password reset email sent successfully');
    showMessage('📧 Password reset email sent! Please check your inbox and spam folder.', 'success', 8000);
    return true;
  } catch (error) {
    console.error('❌ Password reset error:', error);
    let errorMessage = error.message;
    if (errorMessage.includes('user-not-found')) {
      errorMessage = '❌ No account found with this email address';
    } else if (errorMessage.includes('invalid-email')) {
      errorMessage = '❌ Please enter a valid email address';
    } else if (errorMessage.includes('too-many-requests')) {
      errorMessage = '⏰ Too many reset attempts. Please wait before trying again.';
    } else if (!errorMessage.includes('❌')) {
      errorMessage = `❌ Failed to send reset email: ${errorMessage}`;
    }
    showMessage(errorMessage, 'error');
    throw error;
  }
}

export async function getCurrentUserData() {
  if (!auth.currentUser) {
    return null;
  }
  try {
    const userDocRef = doc(db, 'users', auth.currentUser.uid);
    const userDoc = await getDoc(userDocRef);
    if (userDoc.exists()) {
      return userDoc.data();
    } else {
      return {
        uid: auth.currentUser.uid,
        email: auth.currentUser.email,
        displayName: auth.currentUser.displayName || auth.currentUser.email.split('@')[0],
        role: 'student',
        isActive: true,
        profileComplete: false
      };
    }
  } catch (error) {
    console.error('❌ Error fetching user data:', error);
    return null;
  }
}

export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function validatePassword(password) {
  return {
    valid: password.length >= 6,
    length: password.length >= 6,
    hasUpperCase: /[A-Z]/.test(password),
    hasLowerCase: /[a-z]/.test(password),
    hasNumber: /\d/.test(password),
    hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
    strength: calculatePasswordStrength(password)
  };
}

function calculatePasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 2;
  else if (password.length >= 6) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[!@#$%^&*(),.?":{}|<>]/.test(password)) score += 1;
  return Math.min(score, 5);
}

// Role-based access
export function checkRoleAccess(userRole, requiredRole) {
  const roleHierarchy = {
    admin: 3,
    faculty: 2,
    student: 1
  };
  return roleHierarchy[userRole] >= roleHierarchy[requiredRole];
}

// Global error handler for unhandled auth errors
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.code && event.reason.code.startsWith('auth/')) {
    console.error('🔥 Unhandled auth error:', event.reason);
    showMessage('❌ An authentication error occurred. Please try again.', 'error');
    event.preventDefault();
  }
});

console.log('🎉 Enhanced Authentication System loaded successfully!');
console.log('📋 Available functions:', {
  registerUser: '👤 Register new user',
  loginUser: '🔑 Login existing user',
  logoutUser: '🚪 Logout current user',
  checkPortalAccess: '🔍 Check user access',
  changeUserPassword: '🔐 Change password',
  updateUserProfile: '👤 Update profile',
  resetPassword: '📧 Send reset email',
  getCurrentUserData: '📄 Get user data',
  validateEmail: '📧 Validate email format',
  validatePassword: '🔒 Validate password strength',
  getCurrentMode: '🔄 Get current auth mode',
  checkRoleAccess: '🛡️ Check role permissions'
});