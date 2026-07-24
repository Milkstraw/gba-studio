#---------------------------------------------------------------------------------------------------------------------
# P0-FX1 known-bad-oam fixture Makefile. Based on butano's template project
# (external/butano/template/Makefile), trimmed to the minimum.
#
# LIBBUTANO is overridable via `?=` (not `:=`) so this same fixture also
# builds inside the P0-A1 Docker image, where Butano sits at a different
# path (e.g. `make LIBBUTANO=/opt/butano/butano`).
#---------------------------------------------------------------------------------------------------------------------
TARGET      	:=  $(notdir $(CURDIR))
BUILD       	:=  build
LIBBUTANO   	?=  /c/Dev/GBA-Game/external/butano/butano
PYTHON      	:=  python
SOURCES     	:=  src
INCLUDES    	:=  include
DATA        	:=
GRAPHICS    	:=  graphics
AUDIO       	:=  audio
AUDIOBACKEND	:=  maxmod
AUDIOTOOL		:=
DMGAUDIO    	:=  dmg_audio
DMGAUDIOBACKEND	:=  default
ROMTITLE    	:=  FXBADOAM
ROMCODE     	:=  FXBD
USERFLAGS   	:=
USERCXXFLAGS	:=
USERASFLAGS 	:=
USERLDFLAGS 	:=
USERLIBDIRS 	:=
USERLIBS    	:=
DEFAULTLIBS 	:=
STACKTRACE		:=
USERBUILD   	:=
EXTTOOL     	:=

#---------------------------------------------------------------------------------------------------------------------
# Export absolute butano path:
#---------------------------------------------------------------------------------------------------------------------
ifndef LIBBUTANOABS
	export LIBBUTANOABS	:=	$(realpath $(LIBBUTANO))
endif

#---------------------------------------------------------------------------------------------------------------------
# Include main makefile:
#---------------------------------------------------------------------------------------------------------------------
include $(LIBBUTANOABS)/butano.mak
