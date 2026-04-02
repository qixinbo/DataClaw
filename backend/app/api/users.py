from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from typing import List
import secrets
import hashlib
from datetime import datetime, timedelta, timezone

from app.database import get_db
from app.models.user import User, EmailVerification
from app.schemas.user import UserCreate, UserUpdate, UserResponse, ResendVerificationRequest
from app.core.security import get_password_hash, verify_password, create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES
from app.core.email import send_verification_email

router = APIRouter()

def generate_verification_token() -> str:
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

@router.post("/auth/login")
def login(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == form_data.username).first()
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username, "is_admin": user.is_admin, "id": user.id},
        expires_delta=access_token_expires
    )
    
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "avatar": user.avatar,
            "is_admin": user.is_admin
        }
    }

@router.post("/auth/register", response_model=UserResponse)
def register_user(user: UserCreate, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    db_user_email = db.query(User).filter(User.email == user.email).first()
    if db_user_email:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    hashed_password = get_password_hash(user.password)
    
    # If this is the first user, make them an admin
    is_first_user = db.query(User).count() == 0
    is_admin = is_first_user or user.is_admin
    is_active = True if is_first_user else False
    
    db_user = User(
        username=user.username,
        email=user.email,
        avatar=user.avatar,
        hashed_password=hashed_password,
        is_active=is_active,
        is_admin=is_admin
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)

    if not is_active:
        token = generate_verification_token()
        hashed = hash_token(token)
        expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
        verification = EmailVerification(
            user_id=db_user.id,
            token_hash=hashed,
            expires_at=expires_at
        )
        db.add(verification)
        db.commit()
        
        # 将用户的 email 保存到局部变量中，防止在后台任务执行前 session 关闭导致延迟加载失败
        user_email = db_user.email
        background_tasks.add_task(send_verification_email, user_email, token)

    return db_user

@router.get("/auth/verify-email")
def verify_email(token: str, db: Session = Depends(get_db)):
    hashed = hash_token(token)
    verification = db.query(EmailVerification).filter(
        EmailVerification.token_hash == hashed,
        EmailVerification.is_used == False
    ).first()
    
    if not verification:
        raise HTTPException(status_code=400, detail="Invalid or used token")
        
    # Check if expired (make timezone-aware if naive)
    expires_at = verification.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
        
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Token expired")
        
    user = db.query(User).filter(User.id == verification.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    user.is_active = True
    verification.is_used = True
    db.commit()
    
    return {"status": "success", "message": "Email verified successfully"}

@router.post("/auth/resend-verification")
def resend_verification(request: ResendVerificationRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == request.username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    if user.is_active:
        raise HTTPException(status_code=400, detail="User already active")
        
    token = generate_verification_token()
    hashed = hash_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    verification = EmailVerification(
        user_id=user.id,
        token_hash=hashed,
        expires_at=expires_at
    )
    db.add(verification)
    db.commit()
    
    # 提取 email，避免后台任务访问已断开的 db session
    user_email = user.email
    background_tasks.add_task(send_verification_email, user_email, token)
    return {"status": "success", "message": "Verification email sent"}

@router.get("/users", response_model=List[UserResponse])
def read_users(skip: int = 0, limit: int = 100, db: Session = Depends(get_db)):
    users = db.query(User).offset(skip).limit(limit).all()
    return users

@router.get("/users/{user_id}", response_model=UserResponse)
def read_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if db_user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return db_user

@router.post("/users", response_model=UserResponse)
def create_user(user: UserCreate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.username == user.username).first()
    if db_user:
        raise HTTPException(status_code=400, detail="Username already registered")
    
    db_user_email = db.query(User).filter(User.email == user.email).first()
    if db_user_email:
        raise HTTPException(status_code=400, detail="Email already registered")
        
    db_user = User(
        username=user.username,
        email=user.email,
        avatar=user.avatar,
        hashed_password=get_password_hash(user.password),
        is_active=user.is_active,
        is_admin=user.is_admin
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

@router.put("/users/{user_id}", response_model=UserResponse)
def update_user(user_id: int, user: UserUpdate, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    update_data = user.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        if key == "password" and value:
            db_user.hashed_password = get_password_hash(value)
        elif key != "password":
            setattr(db_user, key, value)
            
    db.commit()
    db.refresh(db_user)
    return db_user

@router.delete("/users/{user_id}")
def delete_user(user_id: int, db: Session = Depends(get_db)):
    db_user = db.query(User).filter(User.id == user_id).first()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    
    db.delete(db_user)
    db.commit()
    return {"ok": True}
