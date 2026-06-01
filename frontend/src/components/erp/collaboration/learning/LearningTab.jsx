/**
 * LearningTab.jsx
 * Student-facing LMS interface
 * Phase 2: Full implementation with internal navigation
 * Phase 3.8: Added Study Groups
 */

import { useState, useEffect } from 'react';
import LearningHome from './LearningHome';
import CourseCatalog from './CourseCatalog';
import MyCourses from './MyCourses';
import CourseDetail from './CourseDetail';
import Certificates from './Certificates';
import StudyGroups from './StudyGroups';
import StudyGroupDetail from './StudyGroupDetail';

export default function LearningTab({ user, token, learningView, learningCourseId, onLearningNavigate }) {
  const [currentView, setCurrentView] = useState(learningView || 'home');
  const [selectedCourseId, setSelectedCourseId] = useState(learningCourseId || null);
  const [selectedGroupId, setSelectedGroupId] = useState(null);
  const [previousView, setPreviousView] = useState('home');

  // Sync with external navigation from sidebar
  useEffect(() => {
    if (learningView && learningView !== currentView) {
      setCurrentView(learningView);
      if (learningCourseId) setSelectedCourseId(learningCourseId);
    }
  }, [learningView, learningCourseId]);

  const handleNavigate = (view, options = {}) => {
    // Remember where we came from so onBack can return there
    if (view === 'course-detail' || view === 'study-group-detail') {
      setPreviousView(currentView);
    }
    setCurrentView(view);
    
    // Handle course navigation
    if (options.courseId) {
      setSelectedCourseId(options.courseId);
    }
    
    // Handle study group navigation
    if (options.groupId) {
      setSelectedGroupId(options.groupId);
    }
    
    // Sync with parent (CollaborationPortal)
    if (onLearningNavigate) {
      onLearningNavigate(view, options.courseId);
    }
  };

  const handleBack = () => {
    const dest = previousView || 'home';
    setCurrentView(dest);
    if (onLearningNavigate) onLearningNavigate(dest);
  };

  // Render based on current view
  switch (currentView) {
    case 'catalog':
      return <CourseCatalog onNavigate={handleNavigate} />;
    
    case 'my-courses':
      return <MyCourses onNavigate={handleNavigate} />;
    
    case 'course-detail':
      return (
        <CourseDetail
          courseId={selectedCourseId}
          onBack={handleBack}
        />
      );
    
    case 'certificates':
      return <Certificates onNavigate={handleNavigate} />;
    
    case 'study-groups':
      return <StudyGroups onNavigate={handleNavigate} />;
    
    case 'study-group-detail':
      return (
        <StudyGroupDetail
          groupId={selectedGroupId}
          onNavigate={handleNavigate}
          token={token}
          user={user}
        />
      );
    
    case 'home':
    default:
      return <LearningHome onNavigate={handleNavigate} />;
  }
}
