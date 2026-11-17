@echo off
rem Regera dist\matriz_od.html (e docs\index.html, publicado pelo GitHub Pages) a partir dos ZIPs (requer Python 3.10+).
rem   build.bat            -> build + validacao rapida
rem   build.bat full       -> build + validacao completa (relê o CSV de 716 MB)
python -m pip install -q -r requirements.txt || goto :erro
if not exist vendor\leaflet.min.js python build\fetch_geo.py || goto :erro
if not exist data\geo\malha_mun.json python build\fetch_geo.py --only geo || goto :erro
python build\build.py || goto :erro
if "%1"=="full" (python build\validate.py) else (python build\validate.py --quick)
if exist dist\matriz_od.html (if not exist docs mkdir docs & copy /y dist\matriz_od.html docs\index.html >nul & type nul > docs\.nojekyll)
goto :eof
:erro
echo Falhou. Veja a mensagem acima.
exit /b 1
