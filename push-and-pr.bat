@echo off
REM Pushes the two branches Claude committed and opens a PR for each.
REM Delete this file afterwards - it is a convenience, not part of the project.
cd /d "%~dp0"

echo Pushing feat/fold-overview-into-jobs ...
git push -u origin feat/fold-overview-into-jobs || goto :failed

echo Pushing feat/pipeline-save ...
git push -u origin feat/pipeline-save || goto :failed

where gh >nul 2>nul
if errorlevel 1 goto :nogh

echo Opening pull requests ...
gh pr create --base verify --head feat/fold-overview-into-jobs --fill
gh pr create --base feat/fold-overview-into-jobs --head feat/pipeline-save --fill
echo.
echo Done. Remember to apply sql\007_pipeline.sql to Cloud SQL.
pause
exit /b 0

:nogh
echo.
echo Branches pushed. The GitHub CLI is not installed, so open the PRs here:
echo   https://github.com/nidhipoojari/UMBCHACK/compare/verify...feat/fold-overview-into-jobs
echo   https://github.com/nidhipoojari/UMBCHACK/compare/feat/fold-overview-into-jobs...feat/pipeline-save
echo.
echo Remember to apply sql\007_pipeline.sql to Cloud SQL.
pause
exit /b 0

:failed
echo.
echo Push failed - see the error above. Most likely you need to sign in to git,
echo or the vijayvanapalli96 account lacks write access to nidhipoojari/UMBCHACK.
pause
exit /b 1
