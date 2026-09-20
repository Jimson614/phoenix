@echo off
chcp 65001 >nul
title Phoenix 联调隧道 - 本机 3000 连到腾讯云联调后端 3010
echo 正在连接腾讯云联调后端……
echo 连上后这个窗口不会有新输出，这是正常的。请保持窗口打开，关闭窗口即断开。
echo.
:loop
ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:3000:127.0.0.1:3010 phoenix-tencent
echo [%time%] 连接断开或本机 3000 端口已被占用，5 秒后重试……（按 Ctrl+C 退出）
timeout /t 5 /nobreak >nul
goto loop
